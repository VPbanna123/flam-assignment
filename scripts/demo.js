import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from '../src/core/Worker.js';
import { createDatabase } from '../src/database/db.js';
import { ConfigRepository } from '../src/repositories/ConfigRepository.js';
import { JobRepository } from '../src/repositories/JobRepository.js';
import { WorkerRepository } from '../src/repositories/WorkerRepository.js';
import { ConfigService } from '../src/services/ConfigService.js';
import { JobService } from '../src/services/JobService.js';
import { WorkerService } from '../src/services/WorkerService.js';
import { Logger } from '../src/utils/logger.js';
import { sleep } from '../src/utils/time.js';

function createDemoContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-demo-'));
  const db = createDatabase(path.join(dir, 'queue.db'));
  const configRepository = new ConfigRepository(db);
  const jobRepository = new JobRepository(db);
  const workerRepository = new WorkerRepository(db);
  const configService = new ConfigService(configRepository);
  const jobService = new JobService(jobRepository, configRepository);
  const workerService = new WorkerService(configRepository, workerRepository);

  return {
    dir,
    db,
    configRepository,
    jobRepository,
    workerRepository,
    configService,
    jobService,
    workerService
  };
}

const context = createDemoContext();

try {
  console.log(`Demo database: ${path.join(context.dir, 'queue.db')}`);
  context.configService.set('max-retries', '1');
  context.configService.set('backoff-base', '1');
  context.configService.set('poll-interval-ms', '100');

  console.log('\nEnqueue jobs');
  context.jobService.enqueue({ id: 'demo-success', command: 'echo hello from queuectl' });
  context.jobService.enqueue({ id: 'demo-dead', command: 'node -e "process.exit(1)"', max_retries: 0 });
  console.table(context.jobService.list().map((job) => job.toJSON()));

  console.log('\nStart worker');
  const worker = new Worker({
    workerId: 'demo-worker',
    jobRepository: context.jobRepository,
    configRepository: context.configRepository,
    workerService: context.workerService,
    logger: new Logger()
  });

  const running = worker.start();
  await sleep(1200);
  worker.requestStop();
  await running;

  console.log('\nStatus');
  console.table(context.jobService.status(context.workerRepository));

  console.log('\nDLQ');
  console.table(context.jobService.listDead().map((job) => job.toJSON()));

  console.log('\nRetry DLQ job');
  context.jobService.retryDead('demo-dead');
  console.table(context.jobService.list().map((job) => job.toJSON()));
} finally {
  if (context.db.open) {
    context.db.close();
  }
}
