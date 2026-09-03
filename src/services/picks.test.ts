import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db/index.js';
import { createRepos, type Repos } from '../db/repos.js';
import type { Game } from '../domain/types.js';
import { gradeWeek } from './grade.js';
import { findIncomplete, missingCategories, submitPick, type SubmitRequest } from './picks.js';

const GUILD = 'g';
const USER = 'u1';
const KICKOFF = Date.parse('2026-09-13T17:00:00Z');
const BEFORE = KICKOFF - 60_000;
const AFTER = KICKOFF + 60_000;

let db: Database;
let repos: Repos;

function game(id: string, away: string, home: string, kickoff = KICKOFF): Game {
  return {
    id,
    season: 2026,
    week: 1,
    awayAbbr: away,
    homeAbbr: home,
    kickoff,
    state: 'pre',
    awayScore: null,
    homeScore: null,
  };
}

function request(overrides: Partial<SubmitRequest> = {}): SubmitRequest {
  return {
    guildId: GUILD,
    userId: USER,
    season: 2026,
    week: 1,
    category: 'OVER',
    gameId: 'g1',
    teamAbbr: null,
    timezone: 'America/Chicago',
    ...overrides,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepos(db);
  repos.games.upsertMany([
    game('g1', 'BAL', 'MIA'),
    game('g2', 'ARI', 'CHI'),
    game('g3', 'NYJ', 'NE'),
    game('g4', 'GB', 'MIN'),
    game('g5', 'SF', 'LAR'),
  ]);
});

describe('submitPick', () => {
  it('saves a first pick and reports the slate incomplete', () => {
    const result = submitPick(repos, request(), BEFORE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.complete).toBe(false);
      expect(result.slate).toHaveLength(1);
    }
  });

  it('reports the slate complete once all four are in', () => {
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    submitPick(repos, request({ category: 'UNDER', gameId: 'g2' }), BEFORE);
    submitPick(repos, request({ category: 'FAVORITE', gameId: 'g3', teamAbbr: 'NE' }), BEFORE);
    const last = submitPick(repos, request({ category: 'UNDERDOG', gameId: 'g4', teamAbbr: 'GB' }), BEFORE);

    expect(last.ok && last.complete).toBe(true);
  });

  it('lets a player change a pick while the game is still open', () => {
    submitPick(repos, request({ gameId: 'g1' }), BEFORE);
    const changed = submitPick(repos, request({ gameId: 'g2' }), BEFORE);

    expect(changed.ok).toBe(true);
    expect(repos.picks.forUserWeek(GUILD, USER, 2026, 1)[0]?.gameId).toBe('g2');
  });

  it('refuses a game that has already kicked off', () => {
    const result = submitPick(repos, request(), AFTER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already started');
  });

  it('refuses to change a pick whose game has started, even to an open game', () => {
    submitPick(repos, request({ gameId: 'g1' }), BEFORE);
    repos.games.upsertMany([{ ...game('g1', 'BAL', 'MIA'), state: 'in' }]);

    const result = submitPick(repos, request({ gameId: 'g5' }), BEFORE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('can no longer be changed');
  });

  it('still lets an incomplete player pick an open game after others kicked off', () => {
    repos.games.upsertMany([game('late', 'SEA', 'LV', AFTER + 86_400_000)]);
    const result = submitPick(repos, request({ gameId: 'late' }), AFTER);
    expect(result.ok).toBe(true);
  });

  it('blocks reusing a game across categories', () => {
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    const result = submitPick(repos, request({ category: 'UNDER', gameId: 'g1' }), BEFORE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Ravens @ Dolphins');
      expect(result.reason).toContain('**OVER**');
    }
  });

  it('blocks taking both sides of one game', () => {
    submitPick(repos, request({ category: 'FAVORITE', gameId: 'g1', teamAbbr: 'MIA' }), BEFORE);
    const result = submitPick(
      repos,
      request({ category: 'UNDERDOG', gameId: 'g1', teamAbbr: 'BAL' }),
      BEFORE
    );
    expect(result.ok).toBe(false);
  });

  it('reports the kickoff rather than an overlap when the player is simply too late', () => {
    // Both rules would fire; the lock message is the useful one.
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    const result = submitPick(repos, request({ category: 'UNDER', gameId: 'g1' }), AFTER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already started');
  });

  it('rejects an unknown game rather than storing a dangling pick', () => {
    const result = submitPick(repos, request({ gameId: 'nope' }), BEFORE);
    expect(result.ok).toBe(false);
  });
});

describe('missing picks', () => {
  it('lists the categories a player still owes', () => {
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    const picks = repos.picks.forUserWeek(GUILD, USER, 2026, 1);
    expect(missingCategories(picks)).toEqual(['UNDER', 'FAVORITE', 'UNDERDOG']);
  });

  it('finds participants who have not finished, ignoring those who have', () => {
    submitPick(repos, request({ userId: 'u1', category: 'OVER', gameId: 'g1' }), BEFORE);
    submitPick(repos, request({ userId: 'u2', category: 'OVER', gameId: 'g1' }), BEFORE);
    submitPick(repos, request({ userId: 'u2', category: 'UNDER', gameId: 'g2' }), BEFORE);
    submitPick(repos, request({ userId: 'u2', category: 'FAVORITE', gameId: 'g3', teamAbbr: 'NE' }), BEFORE);
    submitPick(repos, request({ userId: 'u2', category: 'UNDERDOG', gameId: 'g4', teamAbbr: 'GB' }), BEFORE);

    const incomplete = findIncomplete(repos, GUILD, 2026, 1, ['u1', 'u2', 'u3']);
    expect(incomplete.map((i) => i.userId)).toEqual(['u1', 'u3']);
    expect(incomplete[1]?.categories).toHaveLength(4);
  });
});

describe('gradeWeek', () => {
  beforeEach(() => {
    repos.lines.snapshotMany([
      {
        gameId: 'g1',
        season: 2026,
        week: 1,
        overUnder: 46.5,
        spread: -7,
        favoriteAbbr: 'MIA',
        underdogAbbr: 'BAL',
      },
    ]);
  });

  it('gives a participant who never picked an 0-4', () => {
    const summary = gradeWeek(repos, GUILD, 2026, 1, ['ghost']);
    expect(summary.records).toEqual([{ userId: 'ghost', wins: 0, losses: 4, pushes: 0 }]);
  });

  it('grades a real pick against the snapshotted line', () => {
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    repos.games.upsertMany([
      { ...game('g1', 'BAL', 'MIA'), state: 'post', awayScore: 30, homeScore: 24 },
    ]);

    const summary = gradeWeek(repos, GUILD, 2026, 1, [USER]);
    // 54 total clears 46.5, so the over wins; the other three are losses.
    expect(summary.records[0]).toEqual({ userId: USER, wins: 1, losses: 3, pushes: 0 });
  });

  it('includes someone who picked but is no longer a participant', () => {
    submitPick(repos, request({ userId: 'departed', category: 'OVER', gameId: 'g1' }), BEFORE);
    const summary = gradeWeek(repos, GUILD, 2026, 1, []);
    expect(summary.records.map((r) => r.userId)).toContain('departed');
  });

  it('re-grading replaces the previous record', () => {
    submitPick(repos, request({ category: 'OVER', gameId: 'g1' }), BEFORE);
    gradeWeek(repos, GUILD, 2026, 1, [USER]);

    repos.games.upsertMany([
      { ...game('g1', 'BAL', 'MIA'), state: 'post', awayScore: 30, homeScore: 24 },
    ]);
    gradeWeek(repos, GUILD, 2026, 1, [USER]);

    expect(repos.results.season(GUILD, 2026)).toEqual([
      { userId: USER, wins: 1, losses: 3, pushes: 0 },
    ]);
  });
});
