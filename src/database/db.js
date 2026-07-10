import path from 'node:path';
import Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';

export function getDefaultDbPath() {
  return process.env.QUEUECTL_DB_PATH || path.join(process.cwd(), 'queue.db');
}

export function createDatabase(dbPath = getDefaultDbPath()) {
  const db = new Database(dbPath);
  initializeSchema(db);
  return db;
}
