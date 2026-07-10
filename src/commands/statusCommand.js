import { createAppContext } from './context.js';

export function statusCommand() {
  const { db, jobService, workerRepository } = createAppContext();

  try {
    const status = jobService.status(workerRepository);
    const { activeWorkers, ...summary } = status;
    console.table(summary);

    if (activeWorkers.length > 0) {
      console.table(activeWorkers);
    }
  } finally {
    db.close();
  }
}
