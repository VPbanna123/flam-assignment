import { DEFAULT_CONFIG } from '../utils/constants.js';

export function initializeSchema(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'failed', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL,
      worker_id TEXT,
      next_retry_at TEXT NOT NULL,
      run_at TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      stdout TEXT,
      stderr TEXT,
      exit_code INTEGER,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_claimable
      ON jobs (state, next_retry_at, run_at, priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_jobs_state
      ON jobs (state);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stopped_at TEXT
    );
  `);

  const insertDefault = db.prepare(`
    INSERT OR IGNORE INTO config (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
  `);

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    insertDefault.run({ key, value, updated_at: now });
  }
}
