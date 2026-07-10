import { Worker } from '../core/Worker.js';
import { WorkerManager } from '../core/WorkerManager.js';
import { createAppContext } from './context.js';

export async function startWorkerCommand(options = {}) {
  const count = Number(options.count || 1);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Worker count must be a positive integer');
  }

  const startupContext = createAppContext();
  startupContext.configService.clearWorkerStop();
  startupContext.db.close();

  const manager = new WorkerManager(() => {
    const context = createAppContext();
    return new Worker({
      jobRepository: context.jobRepository,
      configRepository: context.configRepository,
      workerService: context.workerService
    });
  });

  await manager.start(count);
}

export function stopWorkerCommand() {
  const { db, configService } = createAppContext();

  try {
    configService.requestWorkerStop();
    console.log('Stop requested. Running workers will finish their current job and exit.');
  } finally {
    db.close();
  }
}
