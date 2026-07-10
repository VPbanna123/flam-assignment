import { createAppContext } from './context.js';

export function enqueueCommand(payload) {
  const { db, jobService } = createAppContext();

  try {
    const job = jobService.enqueue(payload);
    console.log(JSON.stringify(job.toJSON(), null, 2));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      throw new Error('A job with this id already exists');
    }

    throw error;
  } finally {
    db.close();
  }
}
