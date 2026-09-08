import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { createRepos, type Repos } from '../db/repos.js';
import type { Game, GameState } from '../domain/types.js';
import { hasGamesWithin } from './week.js';

const CT = 'America/Chicago';
let repos: Repos;

/** A 2026 week 1 game, given a local Central kickoff. */
function game(id: string, localKickoff: string, state: GameState = 'pre'): Game {
  return {
    id,
    season: 2026,
    week: 1,
    awayAbbr: 'NE',
    homeAbbr: 'SEA',
    kickoff: DateTime.fromISO(localKickoff, { zone: CT }).toMillis(),
    state,
    awayScore: null,
    homeScore: null,
  };
}

/** 21:00 Central on the given date — when the nightly line watch fires. */
function nightOf(date: string): number {
  return DateTime.fromISO(`${date}T21:00`, { zone: CT }).toMillis();
}

beforeEach(() => {
  repos = createRepos(openDatabase(':memory:'));
});

/**
 * The real 2026 week 1 schedule, which opens on a Wednesday — the case that
 * exposed the original hardcoded Wed/Sat/Sun line-watch cron.
 */
describe('nightly line watch against the real 2026 week 1 schedule', () => {
  beforeEach(() => {
    repos.games.upsertMany([
      game('opener', '2026-09-09T19:20'), // Wed
      game('thu', '2026-09-10T19:35'), // Thu
      game('sun-early', '2026-09-13T12:00'), // Sun
      game('sun-late', '2026-09-13T19:20'),
      game('mon', '2026-09-14T19:15'), // Mon
    ]);
  });

  it('scans on Tuesday night, covering the Wednesday opener', () => {
    // The original Wed/Sat/Sun schedule had no Tuesday scan at all, so the
    // season's first game would never have been checked.
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-08'))).toBe(true);
  });

  it('scans on Wednesday night for the Thursday game', () => {
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-09'))).toBe(true);
  });

  it('stays quiet on Thursday and Friday nights, when nothing is due', () => {
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-10'))).toBe(false);
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-11'))).toBe(false);
  });

  it('scans on Saturday night for the Sunday slate', () => {
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-12'))).toBe(true);
  });

  it('scans on Sunday night for the Monday game', () => {
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-13'))).toBe(true);
  });

  it('stays quiet on Monday night, once the week is done', () => {
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-14'))).toBe(false);
  });
});

describe('hasGamesWithin', () => {
  it('ignores a game that has already kicked off', () => {
    repos.games.upsertMany([game('started', '2026-09-09T19:20', 'in')]);
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-08'))).toBe(false);
  });

  it('ignores a game already in the past', () => {
    repos.games.upsertMany([game('gone', '2026-09-08T12:00')]);
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-08'))).toBe(false);
  });

  it('ignores a game more than a day out', () => {
    repos.games.upsertMany([game('far', '2026-09-13T12:00')]);
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-09-08'))).toBe(false);
  });

  it('covers a Saturday game from the Friday night before', () => {
    // Late-season Saturday games would also have been missed by a Wed/Sat/Sun
    // cron, since it had no Friday scan.
    repos.games.upsertMany([game('sat', '2026-12-19T15:30')]);
    expect(hasGamesWithin(repos, 2026, 1, nightOf('2026-12-18'))).toBe(true);
  });
});

describe('duplicate week posting', () => {
  it('is detected by the stored schedule message', () => {
    // An admin runs /openweek manually on setup night; the Tuesday cron then
    // fires and must not post the same week a second time.
    expect(repos.messages.get('g', 2026, 1, 'SCHEDULE')).toBeNull();

    repos.messages.save({
      guildId: 'g',
      season: 2026,
      week: 1,
      kind: 'SCHEDULE',
      channelId: 'c1',
      messageId: 'm1',
    });

    expect(repos.messages.get('g', 2026, 1, 'SCHEDULE')).not.toBeNull();
    // A different week is still free to post.
    expect(repos.messages.get('g', 2026, 2, 'SCHEDULE')).toBeNull();
  });
});
