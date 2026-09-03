import BetterSqlite3, { type Database } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';
import { migrate } from './migrate.js';

/**
 * Opens the database, creating the containing directory and applying any
 * pending migrations.
 *
 * WAL keeps a reader (a slash command) from blocking a writer (a cron job),
 * which matters on a Pi where both share one process but not one transaction.
 */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BetterSqlite3(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Survive a power cut on the Pi without paying a full fsync per write.
  db.pragma('synchronous = NORMAL');

  migrate(db);
  logger.info({ path }, 'database ready');
  return db;
}

export type { Database };
