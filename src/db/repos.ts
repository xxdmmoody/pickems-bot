import type { Database } from 'better-sqlite3';
import type { LineMove } from '../domain/lineMove.js';
import type { Category, Game, GameState, GameWithLine, Line, Pick, WeekRecord } from '../domain/types.js';

/* ------------------------------------------------------------------ guilds */

export interface GuildConfig {
  guildId: string;
  channelId: string;
  roleId: string;
  timezone: string;
  active: boolean;
}

interface GuildRow {
  guild_id: string;
  channel_id: string;
  role_id: string;
  timezone: string;
  active: number;
}

export class GuildRepo {
  constructor(private readonly db: Database) {}

  upsert(config: Omit<GuildConfig, 'active'>): void {
    this.db
      .prepare(
        `INSERT INTO guilds (guild_id, channel_id, role_id, timezone, active, created_at)
         VALUES (@guildId, @channelId, @roleId, @timezone, 1, @now)
         ON CONFLICT (guild_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           role_id    = excluded.role_id,
           timezone   = excluded.timezone,
           active     = 1`
      )
      .run({ ...config, now: Date.now() });
  }

  get(guildId: string): GuildConfig | null {
    const row = this.db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId) as
      | GuildRow
      | undefined;
    return row ? toGuild(row) : null;
  }

  listActive(): GuildConfig[] {
    const rows = this.db.prepare('SELECT * FROM guilds WHERE active = 1').all() as GuildRow[];
    return rows.map(toGuild);
  }

  deactivate(guildId: string): void {
    this.db.prepare('UPDATE guilds SET active = 0 WHERE guild_id = ?').run(guildId);
  }
}

function toGuild(row: GuildRow): GuildConfig {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    roleId: row.role_id,
    timezone: row.timezone,
    active: row.active === 1,
  };
}

/* ----------------------------------------------------------- games & lines */

interface GameRow {
  id: string;
  season: number;
  week: number;
  away_abbr: string;
  home_abbr: string;
  kickoff: number;
  state: GameState;
  away_score: number | null;
  home_score: number | null;
}

interface LineRow {
  game_id: string;
  season: number;
  week: number;
  over_under: number;
  spread: number;
  favorite_abbr: string | null;
  underdog_abbr: string | null;
}

export class GameRepo {
  constructor(private readonly db: Database) {}

  /**
   * Inserts or refreshes games. Scores and state are always updated; kickoff
   * times can shift too (flex scheduling), so they are refreshed as well.
   */
  upsertMany(games: readonly Game[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO games (id, season, week, away_abbr, home_abbr, kickoff, state, away_score, home_score, updated_at)
       VALUES (@id, @season, @week, @awayAbbr, @homeAbbr, @kickoff, @state, @awayScore, @homeScore, @now)
       ON CONFLICT (id) DO UPDATE SET
         kickoff    = excluded.kickoff,
         state      = excluded.state,
         away_score = excluded.away_score,
         home_score = excluded.home_score,
         updated_at = excluded.updated_at`
    );
    const now = Date.now();
    this.db.transaction(() => {
      for (const g of games) stmt.run({ ...g, now });
    })();
  }

  byWeek(season: number, week: number): Game[] {
    const rows = this.db
      .prepare('SELECT * FROM games WHERE season = ? AND week = ? ORDER BY kickoff')
      .all(season, week) as GameRow[];
    return rows.map(toGame);
  }

  get(gameId: string): Game | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
    return row ? toGame(row) : null;
  }

  /** The most recent week any games are stored for — what commands default to. */
  latestWeek(): { season: number; week: number } | null {
    const row = this.db
      .prepare('SELECT season, week FROM games ORDER BY season DESC, week DESC LIMIT 1')
      .get() as { season: number; week: number } | undefined;
    return row ?? null;
  }

  /** Distinct kickoff times still ahead — what the lock-refresh job schedules on. */
  upcomingKickoffs(season: number, week: number, after: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT kickoff FROM games
         WHERE season = ? AND week = ? AND kickoff > ? ORDER BY kickoff`
      )
      .all(season, week, after) as { kickoff: number }[];
    return rows.map((r) => r.kickoff);
  }
}

function toGame(row: GameRow): Game {
  return {
    id: row.id,
    season: row.season,
    week: row.week,
    awayAbbr: row.away_abbr,
    homeAbbr: row.home_abbr,
    kickoff: row.kickoff,
    state: row.state,
    awayScore: row.away_score,
    homeScore: row.home_score,
  };
}

export class LineRepo {
  constructor(private readonly db: Database) {}

  /**
   * Snapshots lines when picks open. Existing rows are left untouched — a line
   * only changes later through `applyMove`, which is the single path that also
   * records an audit entry and triggers an alert.
   */
  snapshotMany(lines: readonly Line[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO lines (game_id, season, week, over_under, spread, favorite_abbr, underdog_abbr, snapshot_at, updated_at)
       VALUES (@gameId, @season, @week, @overUnder, @spread, @favoriteAbbr, @underdogAbbr, @now, @now)
       ON CONFLICT (game_id) DO NOTHING`
    );
    const now = Date.now();
    this.db.transaction(() => {
      for (const l of lines) stmt.run({ ...l, now });
    })();
  }

  /** Overwrites a line after a significant move. */
  applyMove(line: Line): void {
    this.db
      .prepare(
        `UPDATE lines SET over_under = @overUnder, spread = @spread,
           favorite_abbr = @favoriteAbbr, underdog_abbr = @underdogAbbr, updated_at = @now
         WHERE game_id = @gameId`
      )
      .run({ ...line, now: Date.now() });
  }

  byWeek(season: number, week: number): Line[] {
    const rows = this.db
      .prepare('SELECT * FROM lines WHERE season = ? AND week = ?')
      .all(season, week) as LineRow[];
    return rows.map(toLine);
  }

  get(gameId: string): Line | null {
    const row = this.db.prepare('SELECT * FROM lines WHERE game_id = ?').get(gameId) as
      | LineRow
      | undefined;
    return row ? toLine(row) : null;
  }
}

function toLine(row: LineRow): Line {
  return {
    gameId: row.game_id,
    season: row.season,
    week: row.week,
    overUnder: row.over_under,
    spread: row.spread,
    favoriteAbbr: row.favorite_abbr,
    underdogAbbr: row.underdog_abbr,
  };
}

/** Joins a week's games to their lines, dropping games with no line. */
export function joinGamesAndLines(games: readonly Game[], lines: readonly Line[]): GameWithLine[] {
  const byId = new Map(lines.map((l) => [l.gameId, l]));
  const joined: GameWithLine[] = [];
  for (const game of games) {
    const line = byId.get(game.id);
    if (line) joined.push({ game, line });
  }
  return joined;
}

/* ------------------------------------------------------------- line moves */

export class LineMoveRepo {
  constructor(private readonly db: Database) {}

  /**
   * Records a move. Returns false when this exact move was already recorded,
   * which is how a re-run or a restart avoids double-alerting.
   */
  record(move: LineMove): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO line_moves
           (game_id, old_over_under, new_over_under, old_spread, new_spread, flipped, reasons, detected_at)
         VALUES (@gameId, @oldOu, @newOu, @oldSpread, @newSpread, @flipped, @reasons, @now)`
      )
      .run({
        gameId: move.gameId,
        oldOu: move.oldLine.overUnder,
        newOu: move.newLine.overUnder,
        oldSpread: move.oldLine.spread,
        newSpread: move.newLine.spread,
        flipped: move.flipped ? 1 : 0,
        reasons: move.reasons.join(','),
        now: Date.now(),
      });
    return result.changes > 0;
  }

  byWeek(season: number, week: number): LineMoveRecord[] {
    return this.db
      .prepare(
        `SELECT m.* FROM line_moves m
         JOIN games g ON g.id = m.game_id
         WHERE g.season = ? AND g.week = ?
         ORDER BY m.detected_at`
      )
      .all(season, week) as LineMoveRecord[];
  }
}

export interface LineMoveRecord {
  id: number;
  game_id: string;
  old_over_under: number;
  new_over_under: number;
  old_spread: number;
  new_spread: number;
  flipped: number;
  reasons: string;
  detected_at: number;
}

/* ----------------------------------------------------------------- picks */

interface PickRow {
  guild_id: string;
  user_id: string;
  season: number;
  week: number;
  category: Category;
  game_id: string;
  team_abbr: string | null;
}

export class PickRepo {
  constructor(private readonly db: Database) {}

  upsert(pick: Pick): void {
    this.db
      .prepare(
        `INSERT INTO picks (guild_id, user_id, season, week, category, game_id, team_abbr, updated_at)
         VALUES (@guildId, @userId, @season, @week, @category, @gameId, @teamAbbr, @now)
         ON CONFLICT (guild_id, user_id, season, week, category) DO UPDATE SET
           game_id    = excluded.game_id,
           team_abbr  = excluded.team_abbr,
           updated_at = excluded.updated_at`
      )
      .run({ ...pick, now: Date.now() });
  }

  forUserWeek(guildId: string, userId: string, season: number, week: number): Pick[] {
    const rows = this.db
      .prepare('SELECT * FROM picks WHERE guild_id = ? AND user_id = ? AND season = ? AND week = ?')
      .all(guildId, userId, season, week) as PickRow[];
    return rows.map(toPick);
  }

  forWeek(guildId: string, season: number, week: number): Pick[] {
    const rows = this.db
      .prepare('SELECT * FROM picks WHERE guild_id = ? AND season = ? AND week = ?')
      .all(guildId, season, week) as PickRow[];
    return rows.map(toPick);
  }

  /** Everyone in this guild whose week touches `gameId` — the alert audience. */
  forGame(guildId: string, season: number, week: number, gameId: string): Pick[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM picks WHERE guild_id = ? AND season = ? AND week = ? AND game_id = ?'
      )
      .all(guildId, season, week, gameId) as PickRow[];
    return rows.map(toPick);
  }

  distinctUsers(guildId: string, season: number): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT user_id FROM picks WHERE guild_id = ? AND season = ?')
      .all(guildId, season) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }
}

function toPick(row: PickRow): Pick {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    season: row.season,
    week: row.week,
    category: row.category,
    gameId: row.game_id,
    teamAbbr: row.team_abbr,
  };
}

/* --------------------------------------------------------------- results */

export class ResultRepo {
  constructor(private readonly db: Database) {}

  /** Re-grading a week overwrites its rows rather than accumulating them. */
  saveWeek(guildId: string, season: number, week: number, records: readonly WeekRecord[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO results (guild_id, user_id, season, week, wins, losses, pushes, graded_at)
       VALUES (@guildId, @userId, @season, @week, @wins, @losses, @pushes, @now)
       ON CONFLICT (guild_id, user_id, season, week) DO UPDATE SET
         wins = excluded.wins, losses = excluded.losses,
         pushes = excluded.pushes, graded_at = excluded.graded_at`
    );
    const now = Date.now();
    this.db.transaction(() => {
      for (const r of records) stmt.run({ ...r, guildId, season, week, now });
    })();
  }

  forWeek(guildId: string, season: number, week: number): WeekRecord[] {
    return this.db
      .prepare(
        'SELECT user_id AS userId, wins, losses, pushes FROM results WHERE guild_id = ? AND season = ? AND week = ?'
      )
      .all(guildId, season, week) as WeekRecord[];
  }

  /** Season totals, summed in SQL so standings stay cheap as weeks accumulate. */
  season(guildId: string, season: number): { userId: string; wins: number; losses: number; pushes: number }[] {
    return this.db
      .prepare(
        `SELECT user_id AS userId, SUM(wins) AS wins, SUM(losses) AS losses, SUM(pushes) AS pushes
         FROM results WHERE guild_id = ? AND season = ? GROUP BY user_id`
      )
      .all(guildId, season) as { userId: string; wins: number; losses: number; pushes: number }[];
  }

  gradedWeeks(guildId: string, season: number): number[] {
    const rows = this.db
      .prepare('SELECT DISTINCT week FROM results WHERE guild_id = ? AND season = ? ORDER BY week')
      .all(guildId, season) as { week: number }[];
    return rows.map((r) => r.week);
  }
}

/* -------------------------------------------------------------- messages */

export type MessageKind =
  | 'SCHEDULE'
  | 'RECAP'
  | 'RESULTS'
  | 'STANDINGS'
  | 'PICK_OVER'
  | 'PICK_UNDER'
  | 'PICK_FAVORITE'
  | 'PICK_UNDERDOG';

export function pickMessageKind(category: Category): MessageKind {
  return `PICK_${category}` as MessageKind;
}

export interface PostedMessage {
  guildId: string;
  season: number;
  week: number;
  kind: MessageKind;
  channelId: string;
  messageId: string;
}

export class MessageRepo {
  constructor(private readonly db: Database) {}

  save(message: PostedMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages (guild_id, season, week, kind, channel_id, message_id, posted_at)
         VALUES (@guildId, @season, @week, @kind, @channelId, @messageId, @now)
         ON CONFLICT (guild_id, season, week, kind) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           posted_at  = excluded.posted_at`
      )
      .run({ ...message, now: Date.now() });
  }

  get(guildId: string, season: number, week: number, kind: MessageKind): PostedMessage | null {
    const row = this.db
      .prepare(
        `SELECT guild_id AS guildId, season, week, kind, channel_id AS channelId, message_id AS messageId
         FROM messages WHERE guild_id = ? AND season = ? AND week = ? AND kind = ?`
      )
      .get(guildId, season, week, kind) as PostedMessage | undefined;
    return row ?? null;
  }
}

/** Everything the services need, constructed once and passed around. */
export interface Repos {
  guilds: GuildRepo;
  games: GameRepo;
  lines: LineRepo;
  lineMoves: LineMoveRepo;
  picks: PickRepo;
  results: ResultRepo;
  messages: MessageRepo;
}

export function createRepos(db: Database): Repos {
  return {
    guilds: new GuildRepo(db),
    games: new GameRepo(db),
    lines: new LineRepo(db),
    lineMoves: new LineMoveRepo(db),
    picks: new PickRepo(db),
    results: new ResultRepo(db),
    messages: new MessageRepo(db),
  };
}
