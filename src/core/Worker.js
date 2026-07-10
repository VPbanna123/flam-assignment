import { v4 as uuidv4 } from 'uuid';
import { JobExecutor } from './JobExecutor.js';
import { LockManager } from './LockManager.js';
import { RetryManager } from './RetryManager.js';
import { sleep } from '../utils/time.js';
import { Logger } from '../utils/logger.js';

export class Worker {
  constructor({
    workerId = uuidv4(),
    jobRepository,
    configRepository,
    workerService,
    executor = new JobExecutor(),
    logger = new Logger()
  }) {
    this.workerId = workerId;
    this.jobRepository = jobRepository;
    this.workerService = workerService;
    this.executor = executor;
    this.logger = logger;
    this.lockManager = new LockManager(jobRepository);
    this.retryManager = new RetryManager(configRepository);
    this.stopping = false;
    this.lastRecoveryAt = 0;
  }

  requestStop() {
    this.stopping = true;
  }

  async start() {
    this.workerService.register(this.workerId);
    this.logger.info('worker.started', { workerId: this.workerId });

    try {
      while (!this.stopping && !this.workerService.shouldStop(this.workerId)) {
        this.workerService.heartbeat(this.workerId);
        this.recoverExpiredJobs();
        const job = this.lockManager.claimNext(this.workerId, {
          leaseMs: this.workerService.getJobLeaseMs()
        });

        if (!job) {
          await sleep(this.workerService.getPollIntervalMs());
          continue;
        }

        await this.processJob(job);
      }
    } finally {
      this.workerService.stop(this.workerId);
      this.logger.info('worker.stopped', { workerId: this.workerId });
    }
  }

  async processJob(job) {
    this.logger.info('job.started', { workerId: this.workerId, jobId: job.id, command: job.command });
    const heartbeat = this.startJobHeartbeat(job.id);
    let result;

    try {
      result = await this.executor.execute(job.command, { timeoutMs: job.timeout_ms });
    } finally {
      heartbeat.stop();
    }

    if (result.success) {
      const completed = this.jobRepository.markCompleted(job.id, result, this.workerId);
      if (!completed) {
        this.logger.warn('job.completion_ignored', {
          workerId: this.workerId,
          jobId: job.id,
          reason: 'lease_lost'
        });
        return;
      }

      this.logger.info('job.completed', {
        workerId: this.workerId,
        jobId: job.id,
        executionTimeMs: result.durationMs,
        status: 'completed'
      });
      return;
    }

    const failure = this.retryManager.buildFailure(job, result);
    if (failure.shouldRetry) {
      const failed = this.jobRepository.markRetryableFailure(job.id, failure, this.workerId);
      if (!failed) {
        this.logger.warn('job.failure_ignored', {
          workerId: this.workerId,
          jobId: job.id,
          reason: 'lease_lost'
        });
        return;
      }

      this.logger.warn('job.retry_scheduled', {
        workerId: this.workerId,
        jobId: job.id,
        attempts: failure.attempts,
        nextRetryAt: failure.nextRetryAt,
        executionTimeMs: result.durationMs,
        status: 'failed'
      });
      return;
    }

    const dead = this.jobRepository.markDead(job.id, failure, this.workerId);
    if (!dead) {
      this.logger.warn('job.failure_ignored', {
        workerId: this.workerId,
        jobId: job.id,
        reason: 'lease_lost'
      });
      return;
    }

    this.logger.error('job.dead', {
      workerId: this.workerId,
      jobId: job.id,
      attempts: failure.attempts,
      executionTimeMs: result.durationMs,
      status: 'dead',
      error: failure.errorMessage
    });
  }

  startJobHeartbeat(jobId) {
    const heartbeatIntervalMs = this.workerService.getJobHeartbeatIntervalMs();
    const leaseMs = this.workerService.getJobLeaseMs();

    const renew = () => {
      this.workerService.heartbeat(this.workerId);
      const renewed = this.jobRepository.renewLease(jobId, this.workerId, { leaseMs });
      if (!renewed) {
        this.logger.warn('job.heartbeat_failed', {
          workerId: this.workerId,
          jobId,
          reason: 'lease_lost'
        });
      }
    };

    const timer = setInterval(renew, heartbeatIntervalMs);

    return {
      stop() {
        clearInterval(timer);
      }
    };
  }

  recoverExpiredJobs() {
    const now = Date.now();
    const recoveryIntervalMs = this.workerService.getRecoveryIntervalMs();

    if (now - this.lastRecoveryAt < recoveryIntervalMs) {
      return;
    }

    this.lastRecoveryAt = now;
    const recoveredJobs = this.jobRepository.recoverExpiredProcessingJobs();

    for (const job of recoveredJobs) {
      this.logger.warn('job.recovered', {
        workerId: this.workerId,
        jobId: job.id,
        previousWorkerId: job.worker_id,
        leaseExpiredAt: job.lease_expires_at,
        state: 'pending'
      });
    }
  }
}
