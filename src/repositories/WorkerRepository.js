import { WORKER_STATUS } from '../utils/constants.js';
import { nowIso } from '../utils/time.js';

export class WorkerRepository {
  constructor(db) {
    this.db = db;
  }

  register(workerId) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO workers (worker_id, status, heartbeat_at, created_at, stop_requested_at, stopped_at)
      VALUES (?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(worker_id) DO UPDATE SET
        status = excluded.status,
        heartbeat_at = excluded.heartbeat_at,
        stop_requested_at = NULL,
        stopped_at = NULL
    `).run(workerId, WORKER_STATUS.RUNNING, timestamp, timestamp);
  }

  heartbeat(workerId) {
    this.db.prepare(`
      UPDATE workers
      SET heartbeat_at = ?
      WHERE worker_id = ?
    `).run(nowIso(), workerId);
  }

  markStopped(workerId) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE workers
      SET status = ?, heartbeat_at = ?, stopped_at = ?
      WHERE worker_id = ?
    `).run(WORKER_STATUS.STOPPED, timestamp, timestamp, workerId);
  }

  requestStopForRunning() {
    const timestamp = nowIso();
    return this.db.prepare(`
      UPDATE workers
      SET stop_requested_at = ?
      WHERE status = ?
        AND stop_requested_at IS NULL
    `).run(timestamp, WORKER_STATUS.RUNNING).changes;
  }

  shouldStop(workerId) {
    const row = this.db.prepare(`
      SELECT stop_requested_at
      FROM workers
      WHERE worker_id = ?
        AND status = ?
    `).get(workerId, WORKER_STATUS.RUNNING);

    return Boolean(row?.stop_requested_at);
  }

  countRunning({ staleAfterMs = 15000 } = {}) {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM workers
      WHERE status = ?
        AND heartbeat_at >= ?
    `).get(WORKER_STATUS.RUNNING, cutoff);

    return row.count;
  }

  list() {
    return this.db.prepare(`
      SELECT worker_id, status, heartbeat_at, created_at, stop_requested_at, stopped_at
      FROM workers
      ORDER BY heartbeat_at DESC
    `).all();
  }
}
