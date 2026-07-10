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
  }

  requestStop() {
    this.stopping = true;
  }

  async start() {
    this.workerService.register(this.workerId);
    this.logger.info('worker.started', { workerId: this.workerId });

    try {
      while (!this.stopping && !this.workerService.shouldStop()) {
        this.workerService.heartbeat(this.workerId);
        const job = this.lockManager.claimNext(this.workerId);

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
    const result = await this.executor.execute(job.command, { timeoutMs: job.timeout_ms });

    if (result.success) {
      this.jobRepository.markCompleted(job.id, result);
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
      this.jobRepository.markRetryableFailure(job.id, failure);
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

    this.jobRepository.markDead(job.id, failure);
    this.logger.error('job.dead', {
      workerId: this.workerId,
      jobId: job.id,
      attempts: failure.attempts,
      executionTimeMs: result.durationMs,
      status: 'dead',
      error: failure.errorMessage
    });
  }
}
