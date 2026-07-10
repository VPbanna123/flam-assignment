export const JOB_STATES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead'
});

export const CONFIG_KEYS = Object.freeze({
  MAX_RETRIES: 'max_retries',
  BACKOFF_BASE: 'backoff_base',
  POLL_INTERVAL_MS: 'poll_interval_ms',
  JOB_TIMEOUT_MS: 'job_timeout_ms',
  WORKER_STOP_REQUESTED: 'worker_stop_requested'
});

export const DEFAULT_CONFIG = Object.freeze({
  [CONFIG_KEYS.MAX_RETRIES]: '3',
  [CONFIG_KEYS.BACKOFF_BASE]: '2',
  [CONFIG_KEYS.POLL_INTERVAL_MS]: '500',
  [CONFIG_KEYS.JOB_TIMEOUT_MS]: '30000',
  [CONFIG_KEYS.WORKER_STOP_REQUESTED]: 'false'
});

export const VALID_CONFIG_ALIASES = Object.freeze({
  'max-retries': CONFIG_KEYS.MAX_RETRIES,
  'backoff-base': CONFIG_KEYS.BACKOFF_BASE,
  'poll-interval-ms': CONFIG_KEYS.POLL_INTERVAL_MS,
  'job-timeout-ms': CONFIG_KEYS.JOB_TIMEOUT_MS,
  max_retries: CONFIG_KEYS.MAX_RETRIES,
  backoff_base: CONFIG_KEYS.BACKOFF_BASE,
  poll_interval_ms: CONFIG_KEYS.POLL_INTERVAL_MS,
  job_timeout_ms: CONFIG_KEYS.JOB_TIMEOUT_MS
});

export const WORKER_STATUS = Object.freeze({
  RUNNING: 'running',
  STOPPED: 'stopped'
});
