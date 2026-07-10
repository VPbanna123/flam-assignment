import { createAppContext } from './context.js';
import { normalizeState } from '../utils/validation.js';

export function listCommand(options = {}) {
  const { db, jobService } = createAppContext();

  try {
    const state = normalizeState(options.state);
    const jobs = jobService.list(state).map((job) => job.toJSON());
    console.table(jobs);
  } finally {
    db.close();
  }
}
