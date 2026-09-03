import type { Database } from 'better-sqlite3';
import { logger } from '../logger.js';

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 *
 * The statements live here rather than in a .sql file so that `tsc` output is
 * self-contained — no build step has to copy assets into dist/.
 *
 * Append new migrations; never edit an existing one.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — initial schema
  `
  CREATE TABLE guilds (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    timezone   TEXT NOT NULL DEFAULT 'America/Chicago',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  -- Games and lines are league-wide: every guild plays the same slate.
  CREATE TABLE games (
    id         TEXT PRIMARY KEY,
    season     INTEGER NOT NULL,
    week       INTEGER NOT NULL,
    away_abbr  TEXT NOT NULL,
    home_abbr  TEXT NOT NULL,
    kickoff    INTEGER NOT NULL,
    state      TEXT NOT NULL CHECK (state IN ('pre','in','post')),
    away_score INTEGER,
    home_score INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX games_by_week ON games (season, week);

  -- The currently effective line. Written when picks open, and afterwards only
  -- when a significant move is applied. Grading reads this and never refetches,
  -- which matters because ESPN drops odds once a game finals.
  CREATE TABLE lines (
    game_id       TEXT PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
    season        INTEGER NOT NULL,
    week          INTEGER NOT NULL,
    over_under    REAL NOT NULL,
    spread        REAL NOT NULL,
    favorite_abbr TEXT,
    underdog_abbr TEXT,
    snapshot_at   INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX lines_by_week ON lines (season, week);

  CREATE TABLE line_moves (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id        TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    old_over_under REAL NOT NULL,
    new_over_under REAL NOT NULL,
    old_spread     REAL NOT NULL,
    new_spread     REAL NOT NULL,
    flipped        INTEGER NOT NULL,
    reasons        TEXT NOT NULL,
    detected_at    INTEGER NOT NULL
  );
  -- Makes alerts idempotent: the same game arriving at the same numbers can
  -- only ever be recorded, and therefore announced, once.
  CREATE UNIQUE INDEX line_moves_unique ON line_moves (game_id, new_over_under, new_spread);

  CREATE TABLE picks (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    season     INTEGER NOT NULL,
    week       INTEGER NOT NULL,
    category   TEXT NOT NULL CHECK (category IN ('OVER','UNDER','FAVORITE','UNDERDOG')),
    game_id    TEXT NOT NULL,
    team_abbr  TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, season, week, category)
  );
  CREATE INDEX picks_by_week ON picks (guild_id, season, week);
  CREATE INDEX picks_by_game ON picks (season, week, game_id);

  CREATE TABLE results (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    season    INTEGER NOT NULL,
    week      INTEGER NOT NULL,
    wins      INTEGER NOT NULL,
    losses    INTEGER NOT NULL,
    pushes    INTEGER NOT NULL,
    graded_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, season, week)
  );
  CREATE INDEX results_by_season ON results (guild_id, season);

  -- Lets jobs edit messages they posted earlier (locking a dropdown, applying a
  -- line move) after a restart.
  CREATE TABLE messages (
    guild_id   TEXT NOT NULL,
    season     INTEGER NOT NULL,
    week       INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    posted_at  INTEGER NOT NULL,
    PRIMARY KEY (guild_id, season, week, kind)
  );
  `,
];

export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  if (current >= MIGRATIONS.length) {
    logger.debug({ version: current }, 'database schema up to date');
    return;
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;

    logger.info({ from: version, to: version + 1 }, 'applying database migration');
    // DDL plus the version bump in one transaction, so a failure leaves the
    // database on the previous version rather than half-migrated.
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
