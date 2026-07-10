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
});
