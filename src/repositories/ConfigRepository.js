import { DEFAULT_CONFIG } from '../utils/constants.js';
import { nowIso } from '../utils/time.js';

export class ConfigRepository {
  constructor(db) {
    this.db = db;
  }

  get(key) {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (row) {
      return row.value;
    }

    return DEFAULT_CONFIG[key];
  }

  getNumber(key) {
    return Number(this.get(key));
  }

  getBoolean(key) {
    return this.get(key) === 'true';
  }

  set(key, value) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, String(value), timestamp);
  }

  getAll() {
    return this.db.prepare('SELECT key, value, updated_at FROM config ORDER BY key').all();
  }
}
