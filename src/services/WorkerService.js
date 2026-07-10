import { CONFIG_KEYS } from '../utils/constants.js';

export class WorkerService {
  constructor(configRepository, workerRepository) {
    this.configRepository = configRepository;
    this.workerRepository = workerRepository;
  }

  shouldStop(workerId) {
    return this.workerRepository.shouldStop(workerId)
      || this.configRepository.getBoolean(CONFIG_KEYS.WORKER_STOP_REQUESTED);
  }

  getPollIntervalMs() {
    return this.configRepository.getNumber(CONFIG_KEYS.POLL_INTERVAL_MS);
  }

  getJobLeaseMs() {
    return this.configRepository.getNumber(CONFIG_KEYS.JOB_LEASE_MS);
  }

  getJobHeartbeatIntervalMs() {
    return this.configRepository.getNumber(CONFIG_KEYS.JOB_HEARTBEAT_INTERVAL_MS);
  }

  getRecoveryIntervalMs() {
    return this.configRepository.getNumber(CONFIG_KEYS.RECOVERY_INTERVAL_MS);
  }

  register(workerId, options) {
    this.workerRepository.register(workerId, options);
  }

  heartbeat(workerId) {
    this.workerRepository.heartbeat(workerId);
  }

  stop(workerId) {
    this.workerRepository.markStopped(workerId);
  }

  requestStopForRunningWorkers() {
    return this.workerRepository.requestStopForRunning();
  }
}
