import { createDatabase } from '../database/db.js';
import { ConfigRepository } from '../repositories/ConfigRepository.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { WorkerRepository } from '../repositories/WorkerRepository.js';
import { ConfigService } from '../services/ConfigService.js';
import { JobService } from '../services/JobService.js';
import { WorkerService } from '../services/WorkerService.js';

export function createAppContext() {
  const db = createDatabase();
  const configRepository = new ConfigRepository(db);
  const jobRepository = new JobRepository(db);
  const workerRepository = new WorkerRepository(db);
  const configService = new ConfigService(configRepository);
  const jobService = new JobService(jobRepository, configRepository);
  const workerService = new WorkerService(configRepository, workerRepository);

  return {
    db,
    configRepository,
    jobRepository,
    workerRepository,
    configService,
    jobService,
    workerService
  };
}
