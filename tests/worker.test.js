import { describe, expect, test } from '@jest/globals';
import { Worker } from '../src/core/Worker.js';
import { createDatabase } from '../src/database/db.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { createTempContext, FakeExecutor, failureResult, successResult } from './helpers.js';

describe('worker execution', () => {
  test('executes a job successfully and stores output', async () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"ok","command":"echo ok"}');
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor: new FakeExecutor([successResult]),
        logger: context.logger
      });

      const job = context.jobRepository.claimNext('worker-1');
      await worker.processJob(job);
      const persisted = context.jobRepository.findById('ok');

      expect(persisted.state).toBe('completed');
      expect(persisted.stdout).toBe('ok\n');
      expect(persisted.exit_code).toBe(0);
      expect(persisted.duration_ms).toBe(5);
    } finally {
      context.close();
    }
  });

  test('schedules retry with exponential backoff', async () => {
    const context = createTempContext();

    try {
      context.configService.set('backoff-base', '2');
      context.jobService.enqueue('{"id":"retry","command":"exit 1","max_retries":3}');
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor: new FakeExecutor([failureResult]),
        logger: context.logger
      });

      const before = Date.now();
      await worker.processJob(context.jobRepository.claimNext('worker-1'));
      const after = Date.now();
      const job = context.jobRepository.findById('retry');
      const nextRetryAt = new Date(job.next_retry_at).getTime();

      expect(job.state).toBe('failed');
      expect(job.attempts).toBe(1);
      expect(nextRetryAt).toBeGreaterThanOrEqual(before + 1900);
      expect(nextRetryAt).toBeLessThanOrEqual(after + 2500);
    } finally {
      context.close();
    }
  });

  test('moves job to DLQ after max retries', async () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"dead","command":"exit 1","max_retries":0}');
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor: new FakeExecutor([failureResult]),
        logger: context.logger
      });

      await worker.processJob(context.jobRepository.claimNext('worker-1'));
      const job = context.jobRepository.findById('dead');

      expect(job.state).toBe('dead');
      expect(context.jobService.listDead()).toHaveLength(1);
    } finally {
      context.close();
    }
  });

  test('retries a DLQ job by resetting attempts and state', async () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"dead-retry","command":"exit 1","max_retries":0}');
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor: new FakeExecutor([failureResult]),
        logger: context.logger
      });

      await worker.processJob(context.jobRepository.claimNext('worker-1'));
      const retried = context.jobService.retryDead('dead-retry');

      expect(retried.state).toBe('pending');
      expect(retried.attempts).toBe(0);
    } finally {
      context.close();
    }
  });

  test('persists jobs across database connections', () => {
    const context = createTempContext();
    const dbPath = context.dbPath;

    try {
      context.jobService.enqueue('{"id":"persistent","command":"echo saved"}');
      context.db.close();

      const db = createDatabase(dbPath);
      const repo = new JobRepository(db);

      expect(repo.findById('persistent').command).toBe('echo saved');
      db.close();
    } finally {
      context.close();
    }
  });

  test('prevents duplicate processing when two workers claim the same single job', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"only-once","command":"echo once"}');

      const firstClaim = context.jobRepository.claimNext('worker-1');
      const secondClaim = context.jobRepository.claimNext('worker-2');

      expect(firstClaim.id).toBe('only-once');
      expect(secondClaim).toBeNull();
      expect(context.jobRepository.findById('only-once').worker_id).toBe('worker-1');
    } finally {
      context.close();
    }
  });

  test('claims jobs with a renewable processing lease', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"leased","command":"echo leased"}');

      const before = Date.now();
      const claimed = context.jobRepository.claimNext('worker-1', { leaseMs: 30000 });
      const after = Date.now();

      expect(claimed.id).toBe('leased');
      expect(claimed.heartbeat_at).not.toBeNull();
      expect(new Date(claimed.lease_expires_at).getTime()).toBeGreaterThanOrEqual(before + 30000);
      expect(new Date(claimed.lease_expires_at).getTime()).toBeLessThanOrEqual(after + 30050);
    } finally {
      context.close();
    }
  });

  test('renews the lease for the owning worker only', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"renew","command":"echo renew"}');
      const claimed = context.jobRepository.claimNext('worker-1', { leaseMs: 1 });

      const renewed = context.jobRepository.renewLease('renew', 'worker-1', { leaseMs: 30000 });
      const rejected = context.jobRepository.renewLease('renew', 'worker-2', { leaseMs: 30000 });
      const job = context.jobRepository.findById('renew');

      expect(claimed.worker_id).toBe('worker-1');
      expect(renewed).toBe(true);
      expect(rejected).toBe(false);
      expect(job.worker_id).toBe('worker-1');
      expect(new Date(job.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
    } finally {
      context.close();
    }
  });

  test('recovers expired processing jobs back to pending', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"expired","command":"echo expired"}');
      context.jobRepository.claimNext('worker-1', { leaseMs: 1 });

      const recovered = context.jobRepository.recoverExpiredProcessingJobs(
        new Date(Date.now() + 1000).toISOString()
      );
      const job = context.jobRepository.findById('expired');

      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe('expired');
      expect(job.state).toBe('pending');
      expect(job.worker_id).toBeNull();
      expect(job.heartbeat_at).toBeNull();
      expect(job.lease_expires_at).toBeNull();
      expect(job.last_error).toBe('Worker lease expired while processing');
    } finally {
      context.close();
    }
  });

  test('multiple workers claim different jobs', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"job-a","command":"echo a"}');
      context.jobService.enqueue('{"id":"job-b","command":"echo b"}');

      const firstClaim = context.jobRepository.claimNext('worker-1');
      const secondClaim = context.jobRepository.claimNext('worker-2');

      expect(new Set([firstClaim.id, secondClaim.id])).toEqual(new Set(['job-a', 'job-b']));
      expect(firstClaim.id).not.toBe(secondClaim.id);
    } finally {
      context.close();
    }
  });

  test('gracefully stops after stop is requested', async () => {
    const context = createTempContext();

    try {
      context.configService.set('poll-interval-ms', '10');
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor: new FakeExecutor([]),
        logger: context.logger
      });

      const running = worker.start();
      setTimeout(() => worker.requestStop(), 25);
      await running;

      const workers = context.workerRepository.list();
      expect(workers[0].status).toBe('stopped');
    } finally {
      context.close();
    }
  });

  test('renews a job lease while processing a long-running job', async () => {
    const context = createTempContext();

    try {
      context.configService.set('job-lease-ms', '50');
      context.configService.set('job-heartbeat-interval-ms', '10');
      context.jobService.enqueue('{"id":"long","command":"sleep"}');

      let finishExecution;
      const executor = {
        execute: () => new Promise((resolve) => {
          finishExecution = () => resolve(successResult);
        })
      };
      const worker = new Worker({
        workerId: 'worker-1',
        jobRepository: context.jobRepository,
        configRepository: context.configRepository,
        workerService: context.workerService,
        executor,
        logger: context.logger
      });

      const job = context.jobRepository.claimNext('worker-1', { leaseMs: 50 });
      const initialLeaseExpiresAt = context.jobRepository.findById('long').lease_expires_at;
      const processing = worker.processJob(job);

      await new Promise((resolve) => setTimeout(resolve, 25));
      const renewedLeaseExpiresAt = context.jobRepository.findById('long').lease_expires_at;
      finishExecution();
      await processing;

      expect(new Date(renewedLeaseExpiresAt).getTime()).toBeGreaterThan(
        new Date(initialLeaseExpiresAt).getTime()
      );
      expect(context.jobRepository.findById('long').state).toBe('completed');
    } finally {
      context.close();
    }
  });
});
