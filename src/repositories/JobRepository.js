import { JOB_COLUMNS } from '../database/queries.js';
import { JOB_STATES } from '../utils/constants.js';
import { nowIso } from '../utils/time.js';
import { Job } from '../models/Job.js';

export class JobRepository {
  constructor(db) {
    this.db = db;
  }

  create(job) {
    this.db.prepare(`
      INSERT INTO jobs (
        id, command, state, attempts, max_retries, worker_id, next_retry_at, run_at,
        priority, timeout_ms, created_at, updated_at, last_error
      )
      VALUES (
        @id, @command, @state, @attempts, @max_retries, @worker_id, @next_retry_at,
        @run_at, @priority, @timeout_ms, @created_at, @updated_at, @last_error
      )
    `).run(job);

    return this.findById(job.id);
  }

  findById(id) {
    const row = this.db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`).get(id);
    return row ? new Job(row) : null;
  }

  list({ state } = {}) {
    const sql = state
      ? `SELECT ${JOB_COLUMNS} FROM jobs WHERE state = ? ORDER BY created_at DESC`
      : `SELECT ${JOB_COLUMNS} FROM jobs ORDER BY created_at DESC`;
    const rows = state ? this.db.prepare(sql).all(state) : this.db.prepare(sql).all();
    return rows.map((row) => new Job(row));
  }

  listDead() {
    return this.list({ state: JOB_STATES.DEAD });
  }

  countByState() {
    const rows = this.db.prepare(`
      SELECT state, COUNT(*) AS count
      FROM jobs
      GROUP BY state
    `).all();

    return Object.fromEntries(rows.map((row) => [row.state, row.count]));
  }

  claimNext(workerId) {
    const claim = this.db.transaction(() => {
      const now = nowIso();
      const candidate = this.db.prepare(`
        SELECT id
        FROM jobs
        WHERE state IN ('pending', 'failed')
          AND next_retry_at <= ?
          AND run_at <= ?
        ORDER BY priority DESC, run_at ASC, created_at ASC
        LIMIT 1
      `).get(now, now);

      if (!candidate) {
        return null;
      }

      const result = this.db.prepare(`
        UPDATE jobs
        SET state = 'processing',
            worker_id = ?,
            started_at = ?,
            updated_at = ?
        WHERE id = ?
          AND state IN ('pending', 'failed')
          AND next_retry_at <= ?
          AND run_at <= ?
      `).run(workerId, now, now, candidate.id, now, now);

      if (result.changes !== 1) {
        return null;
      }

      return this.findById(candidate.id);
    });

    return claim();
  }

  markCompleted(id, result) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE jobs
      SET state = 'completed',
          stdout = @stdout,
          stderr = @stderr,
          exit_code = @exit_code,
          duration_ms = @duration_ms,
          completed_at = @completed_at,
          updated_at = @updated_at,
          last_error = NULL
      WHERE id = @id
    `).run({
      id,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      completed_at: timestamp,
      updated_at: timestamp
    });
  }

  markRetryableFailure(id, failure) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE jobs
      SET state = 'failed',
          attempts = @attempts,
          worker_id = NULL,
          next_retry_at = @next_retry_at,
          stdout = @stdout,
          stderr = @stderr,
          exit_code = @exit_code,
          duration_ms = @duration_ms,
          last_error = @last_error,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id,
      attempts: failure.attempts,
      next_retry_at: failure.nextRetryAt,
      stdout: failure.stdout,
      stderr: failure.stderr,
      exit_code: failure.exitCode,
      duration_ms: failure.durationMs,
      last_error: failure.errorMessage,
      updated_at: timestamp
    });
  }

  markDead(id, failure) {
    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE jobs
      SET state = 'dead',
          attempts = @attempts,
          worker_id = NULL,
          stdout = @stdout,
          stderr = @stderr,
          exit_code = @exit_code,
          duration_ms = @duration_ms,
          last_error = @last_error,
          completed_at = @completed_at,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id,
      attempts: failure.attempts,
      stdout: failure.stdout,
      stderr: failure.stderr,
      exit_code: failure.exitCode,
      duration_ms: failure.durationMs,
      last_error: failure.errorMessage,
      completed_at: timestamp,
      updated_at: timestamp
    });
  }

  retryDead(id) {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      UPDATE jobs
      SET state = 'pending',
          attempts = 0,
          worker_id = NULL,
          next_retry_at = ?,
          run_at = ?,
          updated_at = ?,
          last_error = NULL
      WHERE id = ?
        AND state = 'dead'
    `).run(timestamp, timestamp, timestamp, id);

    return result.changes === 1 ? this.findById(id) : null;
  }

  resetStaleProcessingJobs(cutoffIso) {
    return this.db.prepare(`
      UPDATE jobs
      SET state = 'failed',
          worker_id = NULL,
          last_error = 'Worker heartbeat expired while processing',
          updated_at = ?
      WHERE state = 'processing'
        AND started_at <= ?
    `).run(nowIso(), cutoffIso).changes;
  }
}
