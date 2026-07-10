import { createAppContext } from './context.js';

export function statusCommand() {
  const { db, jobService, workerRepository } = createAppContext();

  try {
    const status = jobService.status(workerRepository);
    console.table(status);
  } finally {
    db.close();
  }
}
