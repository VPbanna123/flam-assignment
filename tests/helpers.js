import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../src/database/db.js';
import { ConfigRepository } from '../src/repositories/ConfigRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { WorkerRepository } from '../src/repositories/WorkerRepository.js';
import { ConfigService } from '../src/services/ConfigService.js';
import { JobService } from '../src/services/JobService.js';
import { WorkerService } from '../src/services/WorkerService.js';
import { Logger } from '../src/utils/logger.js';

export function createTempContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-test-'));
  const dbPath = path.join(dir, 'queue.db');
  const db = createDatabase(dbPath);
  const configRepository = new ConfigRepository(db);
  const jobRepository = new JobRepository(db);
  const workerRepository = new WorkerRepository(db);
  const configService = new ConfigService(configRepository);
  const jobService = new JobService(jobRepository, configRepository);
  const workerService = new WorkerService(configRepository, workerRepository);

  return {
    dir,
    dbPath,
    db,
    configRepository,
    jobRepository,
    workerRepository,
    configService,
    jobService,
    workerService,
    logger: new Logger({ silent: true }),
    close() {
      if (db.open) {
        db.close();
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export class FakeExecutor {
  constructor(results) {
    this.results = [...results];
    this.executed = [];
  }

  async execute(command) {
    this.executed.push(command);
    return this.results.shift();
  }
}

export const successResult = {
  success: true,
  stdout: 'ok\n',
  stderr: '',
  exitCode: 0,
  durationMs: 5,
  errorMessage: null
};

export const failureResult = {
  success: false,
  stdout: '',
  stderr: 'bad\n',
  exitCode: 1,
  durationMs: 7,
  errorMessage: 'Command failed'
};
