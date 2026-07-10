import { v4 as uuidv4 } from 'uuid';
import { JOB_STATES } from '../utils/constants.js';
import { nowIso } from '../utils/time.js';
import { parseJobPayload } from '../utils/validation.js';

export class JobService {
  constructor(jobRepository, configRepository) {
    this.jobRepository = jobRepository;
    this.configRepository = configRepository;
  }

  enqueue(payload) {
    const parsed = typeof payload === 'string' ? parseJobPayload(payload) : payload;
    const timestamp = nowIso();
    const maxRetries = parsed.max_retries ?? parsed.maxRetries ?? this.configRepository.getNumber('max_retries');
    const runAt = parsed.run_at ?? parsed.runAt ?? timestamp;

    return this.jobRepository.create({
      id: parsed.id || uuidv4(),
      command: parsed.command.trim(),
      state: JOB_STATES.PENDING,
      attempts: 0,
      max_retries: Number(maxRetries),
      worker_id: null,
      next_retry_at: runAt,
      run_at: runAt,
      priority: Number(parsed.priority ?? 0),
      timeout_ms: parsed.timeout_ms ?? parsed.timeoutMs ?? this.configRepository.getNumber('job_timeout_ms'),
      created_at: timestamp,
      updated_at: timestamp,
      last_error: null
    });
  }

  list(state) {
    return this.jobRepository.list({ state });
  }

  status(workerRepository) {
    const counts = this.jobRepository.countByState();
    const activeWorkers = workerRepository.listActive();

    return {
      pending: counts.pending || 0,
      processing: counts.processing || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      dead: counts.dead || 0,
      runningWorkers: activeWorkers.length,
      activeWorkers
    };
  }

  listDead() {
    return this.jobRepository.listDead();
  }

  retryDead(jobId) {
    const job = this.jobRepository.retryDead(jobId);
    if (!job) {
      throw new Error(`Dead job "${jobId}" was not found`);
    }

    return job;
  }
}
