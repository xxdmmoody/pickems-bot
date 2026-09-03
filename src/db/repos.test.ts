import { beforeEach, describe, expect, it } from 'vitest';
import { detectMove } from '../domain/lineMove.js';
import type { Game, Line } from '../domain/types.js';
import { openDatabase, type Database } from './index.js';
import { createRepos, joinGamesAndLines, type Repos } from './repos.js';

let db: Database;
let repos: Repos;

const GUILD = 'guild-1';

function game(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    season: 2026,
    week: 1,
    awayAbbr: 'BAL',
    homeAbbr: 'MIA',
    kickoff: Date.parse('2026-09-13T17:00:00Z'),
    state: 'pre',
    awayScore: null,
    homeScore: null,
    ...overrides,
  };
}

function line(gameId: string, spread = -7, overUnder = 46.5): Line {
  return {
    gameId,
    season: 2026,
    week: 1,
    overUnder,
    spread,
    favoriteAbbr: spread < 0 ? 'MIA' : 'BAL',
    underdogAbbr: spread < 0 ? 'BAL' : 'MIA',
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepos(db);
});

describe('migrations', () => {
  it('bring a fresh database to the current version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('are idempotent', () => {
    const second = openDatabase(':memory:');
    expect(second.pragma('user_version', { simple: true })).toBe(1);
  });
});

describe('guilds', () => {
  it('round-trips a configuration', () => {
    repos.guilds.upsert({ guildId: GUILD, channelId: 'c1', roleId: 'r1', timezone: 'America/Chicago' });
    expect(repos.guilds.get(GUILD)).toEqual({
      guildId: GUILD,
      channelId: 'c1',
      roleId: 'r1',
      timezone: 'America/Chicago',
      active: true,
    });
  });

  it('re-running setup updates rather than duplicates', () => {
    repos.guilds.upsert({ guildId: GUILD, channelId: 'c1', roleId: 'r1', timezone: 'America/Chicago' });
    repos.guilds.upsert({ guildId: GUILD, channelId: 'c2', roleId: 'r2', timezone: 'America/New_York' });
    expect(repos.guilds.listActive()).toHaveLength(1);
    expect(repos.guilds.get(GUILD)?.channelId).toBe('c2');
  });
});

describe('games and lines', () => {
  it('updates scores and state on refetch without duplicating games', () => {
    repos.games.upsertMany([game('g1')]);
    repos.games.upsertMany([game('g1', { state: 'post', awayScore: 21, homeScore: 31 })]);

    const stored = repos.games.byWeek(2026, 1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ state: 'post', awayScore: 21, homeScore: 31 });
  });

  it('snapshots a line once and leaves it alone on a re-snapshot', () => {
    repos.games.upsertMany([game('g1')]);
    repos.lines.snapshotMany([line('g1', -7, 46.5)]);
    // A later open-week run must not silently move the number people saw.
    repos.lines.snapshotMany([line('g1', -3, 41)]);

    expect(repos.lines.get('g1')).toMatchObject({ spread: -7, overUnder: 46.5 });
  });

  it('applies a move as the single path that changes a line', () => {
    repos.games.upsertMany([game('g1')]);
    repos.lines.snapshotMany([line('g1', -7, 46.5)]);
    repos.lines.applyMove(line('g1', -2.5, 41.5));

    expect(repos.lines.get('g1')).toMatchObject({ spread: -2.5, overUnder: 41.5 });
  });

  it('joins games to lines, dropping games with no line', () => {
    repos.games.upsertMany([game('g1'), game('g2')]);
    repos.lines.snapshotMany([line('g1')]);

    const joined = joinGamesAndLines(repos.games.byWeek(2026, 1), repos.lines.byWeek(2026, 1));
    expect(joined.map((j) => j.game.id)).toEqual(['g1']);
  });

  it('lists only kickoffs still ahead', () => {
    const early = Date.parse('2026-09-13T17:00:00Z');
    const late = Date.parse('2026-09-13T20:00:00Z');
    repos.games.upsertMany([game('g1', { kickoff: early }), game('g2', { kickoff: late })]);

    expect(repos.games.upcomingKickoffs(2026, 1, early)).toEqual([late]);
  });
});

describe('line moves', () => {
  beforeEach(() => {
    repos.games.upsertMany([game('g1')]);
    repos.lines.snapshotMany([line('g1', -7, 46.5)]);
  });

  it('records a move once and refuses the duplicate', () => {
    const move = detectMove(line('g1', -7, 46.5), line('g1', -2.5, 46.5))!;
    expect(repos.lineMoves.record(move)).toBe(true);
    // A restart or a re-run of the watcher must not alert twice.
    expect(repos.lineMoves.record(move)).toBe(false);
  });

  it('accepts a further move to different numbers', () => {
    expect(repos.lineMoves.record(detectMove(line('g1', -7, 46.5), line('g1', -2.5, 46.5))!)).toBe(true);
    expect(repos.lineMoves.record(detectMove(line('g1', -2.5, 46.5), line('g1', 1, 46.5))!)).toBe(true);
    expect(repos.lineMoves.byWeek(2026, 1)).toHaveLength(2);
  });
});

describe('picks', () => {
  const basePick = {
    guildId: GUILD,
    userId: 'u1',
    season: 2026,
    week: 1,
    gameId: 'g1',
    teamAbbr: null,
  };

  it('keeps one pick per category and overwrites on change', () => {
    repos.picks.upsert({ ...basePick, category: 'OVER' });
    repos.picks.upsert({ ...basePick, category: 'OVER', gameId: 'g2' });

    const picks = repos.picks.forUserWeek(GUILD, 'u1', 2026, 1);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.gameId).toBe('g2');
  });

  it('stores all four categories independently', () => {
    repos.picks.upsert({ ...basePick, category: 'OVER' });
    repos.picks.upsert({ ...basePick, category: 'UNDER', gameId: 'g2' });
    repos.picks.upsert({ ...basePick, category: 'FAVORITE', gameId: 'g3', teamAbbr: 'BAL' });
    repos.picks.upsert({ ...basePick, category: 'UNDERDOG', gameId: 'g4', teamAbbr: 'MIA' });

    expect(repos.picks.forUserWeek(GUILD, 'u1', 2026, 1)).toHaveLength(4);
  });

  it('isolates guilds from each other', () => {
    repos.picks.upsert({ ...basePick, category: 'OVER' });
    repos.picks.upsert({ ...basePick, guildId: 'guild-2', category: 'OVER' });

    expect(repos.picks.forWeek(GUILD, 2026, 1)).toHaveLength(1);
    expect(repos.picks.forWeek('guild-2', 2026, 1)).toHaveLength(1);
  });

  it('finds everyone affected by one game', () => {
    repos.picks.upsert({ ...basePick, category: 'OVER' });
    repos.picks.upsert({ ...basePick, userId: 'u2', category: 'FAVORITE', teamAbbr: 'MIA' });
    repos.picks.upsert({ ...basePick, userId: 'u3', category: 'UNDER', gameId: 'other' });

    const affected = repos.picks.forGame(GUILD, 2026, 1, 'g1');
    expect(affected.map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
  });
});

describe('results', () => {
  it('sums a season across weeks', () => {
    repos.results.saveWeek(GUILD, 2026, 1, [{ userId: 'u1', wins: 4, losses: 0, pushes: 0 }]);
    repos.results.saveWeek(GUILD, 2026, 2, [{ userId: 'u1', wins: 2, losses: 1, pushes: 1 }]);

    expect(repos.results.season(GUILD, 2026)).toEqual([
      { userId: 'u1', wins: 6, losses: 1, pushes: 1 },
    ]);
  });

  it('re-grading a week replaces it instead of double counting', () => {
    repos.results.saveWeek(GUILD, 2026, 1, [{ userId: 'u1', wins: 4, losses: 0, pushes: 0 }]);
    repos.results.saveWeek(GUILD, 2026, 1, [{ userId: 'u1', wins: 3, losses: 1, pushes: 0 }]);

    expect(repos.results.season(GUILD, 2026)).toEqual([
      { userId: 'u1', wins: 3, losses: 1, pushes: 0 },
    ]);
  });

  it('tracks which weeks have been graded', () => {
    repos.results.saveWeek(GUILD, 2026, 1, [{ userId: 'u1', wins: 4, losses: 0, pushes: 0 }]);
    repos.results.saveWeek(GUILD, 2026, 3, [{ userId: 'u1', wins: 4, losses: 0, pushes: 0 }]);
    expect(repos.results.gradedWeeks(GUILD, 2026)).toEqual([1, 3]);
  });
});

describe('messages', () => {
  it('remembers a posted message so a later job can edit it', () => {
    repos.messages.save({
      guildId: GUILD,
      season: 2026,
      week: 1,
      kind: 'PICK_OVER',
      channelId: 'c1',
      messageId: 'm1',
    });
    repos.messages.save({
      guildId: GUILD,
      season: 2026,
      week: 1,
      kind: 'PICK_OVER',
      channelId: 'c1',
      messageId: 'm2',
    });

    expect(repos.messages.get(GUILD, 2026, 1, 'PICK_OVER')?.messageId).toBe('m2');
    expect(repos.messages.get(GUILD, 2026, 1, 'SCHEDULE')).toBeNull();
  });
});
