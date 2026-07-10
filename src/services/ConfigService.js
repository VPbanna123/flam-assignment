import { CONFIG_KEYS } from '../utils/constants.js';
import { assertNonNegativeInteger, assertPositiveInteger, normalizeConfigKey } from '../utils/validation.js';

export class ConfigService {
  constructor(configRepository) {
    this.configRepository = configRepository;
  }

  set(rawKey, value) {
    const key = normalizeConfigKey(rawKey);

    if (key === CONFIG_KEYS.MAX_RETRIES) {
      assertNonNegativeInteger(value, 'max-retries');
    } else {
      assertPositiveInteger(value, rawKey);
    }

    this.configRepository.set(key, String(value));
    return { key, value: String(value) };
  }

  getAll() {
    return this.configRepository.getAll();
  }

  requestWorkerStop() {
    this.configRepository.set(CONFIG_KEYS.WORKER_STOP_REQUESTED, 'true');
  }

  clearWorkerStop() {
    this.configRepository.set(CONFIG_KEYS.WORKER_STOP_REQUESTED, 'false');
  }
}
