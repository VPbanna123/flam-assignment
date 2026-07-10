import { calculateBackoffSeconds } from '../utils/backoff.js';

export class RetryManager {
  constructor(configRepository) {
    this.configRepository = configRepository;
  }

  buildFailure(job, executionResult) {
    const attempts = job.attempts + 1;
    const errorMessage = executionResult.errorMessage || `Command failed with exit code ${executionResult.exitCode}`;
    const base = this.configRepository.getNumber('backoff_base');
    const delaySeconds = calculateBackoffSeconds(base, attempts);

    return {
      attempts,
      shouldRetry: attempts <= job.max_retries,
      nextRetryAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      stdout: executionResult.stdout,
      stderr: executionResult.stderr,
      exitCode: executionResult.exitCode,
      durationMs: executionResult.durationMs,
      errorMessage
    };
  }
}
