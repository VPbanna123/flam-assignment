import { WORKER_STATUS } from '../utils/constants.js';
import { nowIso } from '../utils/time.js';

export class WorkerRepository {
  constructor(db) {
    this.db = db;
  }

  register(workerId, { pid = process.pid } = {}) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO workers (
        worker_id, pid, status, heartbeat_at, created_at, started_at,
        last_heartbeat, stop_requested_at, stopped_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(worker_id) DO UPDATE SET
        pid = excluded.pid,
        status = excluded.status,
        heartbeat_at = excluded.heartbeat_at,
        started_at = excluded.started_at,
        last_heartbeat = excluded.last_heartbeat,
        stop_requested_at = NULL,
        stopped_at = NULL
    `).run(
      workerId,
      pid,
      WORKER_STATUS.RUNNING,
      timestamp,
      timestamp,
      timestamp,
      timestamp
    );
  }

  heartbeat(workerId) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE workers
      SET heartbeat_at = ?,
          last_heartbeat = ?
      WHERE worker_id = ?
    `).run(timestamp, timestamp, workerId);
  }

  markStopped(workerId) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE workers
      SET status = ?,
          heartbeat_at = ?,
          last_heartbeat = ?,
          stopped_at = ?
      WHERE worker_id = ?
    `).run(WORKER_STATUS.STOPPED, timestamp, timestamp, timestamp, workerId);
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
    this.removeStale({ staleAfterMs });
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM workers
      WHERE status = ?
        AND COALESCE(last_heartbeat, heartbeat_at) >= ?
    `).get(WORKER_STATUS.RUNNING, cutoff);

    return row.count;
  }

  listActive({ staleAfterMs = 15000 } = {}) {
    this.removeStale({ staleAfterMs });
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    return this.db.prepare(`
      SELECT
        worker_id,
        pid,
        COALESCE(started_at, created_at) AS started_at,
        COALESCE(last_heartbeat, heartbeat_at) AS last_heartbeat,
        status
      FROM workers
      WHERE status = ?
        AND COALESCE(last_heartbeat, heartbeat_at) >= ?
      ORDER BY COALESCE(last_heartbeat, heartbeat_at) DESC
    `).all(WORKER_STATUS.RUNNING, cutoff);
  }

  removeStale({ staleAfterMs = 15000 } = {}) {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const timestamp = nowIso();
    return this.db.prepare(`
      UPDATE workers
      SET status = ?,
          stopped_at = ?
      WHERE status = ?
        AND COALESCE(last_heartbeat, heartbeat_at) < ?
    `).run(WORKER_STATUS.STOPPED, timestamp, WORKER_STATUS.RUNNING, cutoff).changes;
  }

  list() {
    return this.db.prepare(`
      SELECT
        worker_id,
        pid,
        status,
        heartbeat_at,
        created_at,
        COALESCE(started_at, created_at) AS started_at,
        COALESCE(last_heartbeat, heartbeat_at) AS last_heartbeat,
        stop_requested_at,
        stopped_at
      FROM workers
      ORDER BY COALESCE(last_heartbeat, heartbeat_at) DESC
    `).all();
  }
}
