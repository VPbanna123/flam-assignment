import { createAppContext } from './context.js';

export function listDlqCommand() {
  const { db, jobService } = createAppContext();

  try {
    console.table(jobService.listDead().map((job) => job.toJSON()));
  } finally {
    db.close();
  }
}

export function retryDlqCommand(jobId) {
  const { db, jobService } = createAppContext();

  try {
    const job = jobService.retryDead(jobId);
    console.log(JSON.stringify(job.toJSON(), null, 2));
  } finally {
    db.close();
  }
}
