import { describe, expect, it } from 'vitest';
import { checkLock, isGameLocked, unlockedGames } from './lock.js';
import type { Game, GameState, Pick } from './types.js';

const KICKOFF = Date.parse('2026-09-13T17:00:00Z');
const BEFORE = KICKOFF - 60_000;
const AFTER = KICKOFF + 60_000;

function game(id: string, kickoff = KICKOFF, state: GameState = 'pre'): Game {
  return {
    id,
    season: 2026,
    week: 1,
    awayAbbr: 'ARI',
    homeAbbr: 'BAL',
    kickoff,
    state,
    awayScore: null,
    homeScore: null,
  };
}

function pick(gameId: string): Pick {
  return {
    guildId: 'g',
    userId: 'u',
    season: 2026,
    week: 1,
    category: 'OVER',
    gameId,
    teamAbbr: null,
  };
}

describe('isGameLocked', () => {
  it('is open before kickoff', () => {
    expect(isGameLocked(game('g1'), BEFORE)).toBe(false);
  });

  it('locks at exactly kickoff', () => {
    expect(isGameLocked(game('g1'), KICKOFF)).toBe(true);
  });

  it('locks once ESPN reports the game in progress, even ahead of schedule', () => {
    expect(isGameLocked(game('g1', KICKOFF, 'in'), BEFORE)).toBe(true);
  });

  it('locks a finished game', () => {
    expect(isGameLocked(game('g1', KICKOFF, 'post'), AFTER)).toBe(true);
  });
});

describe('checkLock', () => {
  it('allows a first pick on an open game', () => {
    expect(checkLock('OVER', game('g1'), null, null, BEFORE)).toBeNull();
  });

  it('allows changing a pick while both games are open', () => {
    expect(checkLock('OVER', game('g2'), pick('g1'), game('g1'), BEFORE)).toBeNull();
  });

  it('rejects picking a game that already started', () => {
    expect(checkLock('OVER', game('g1'), null, null, AFTER)).toEqual({
      kind: 'GAME_STARTED',
      gameId: 'g1',
    });
  });

  it('rejects changing a pick whose game already started', () => {
    const started = game('g1', BEFORE - 1000, 'in');
    expect(checkLock('OVER', game('g2'), pick('g1'), started, BEFORE)).toEqual({
      kind: 'PICK_LOCKED',
      category: 'OVER',
      gameId: 'g1',
    });
  });

  it('lets a player with no pick yet still pick an open game after others kicked off', () => {
    // The Thursday game has started; a Sunday game is still fair play.
    const sunday = game('g2', AFTER + 86_400_000);
    expect(checkLock('OVER', sunday, null, null, AFTER)).toBeNull();
  });
});

describe('unlockedGames', () => {
  it('keeps only games that have not started', () => {
    const entries = [
      { game: game('early', KICKOFF - 7_200_000) },
      { game: game('later', KICKOFF + 7_200_000) },
    ];
    expect(unlockedGames(entries, KICKOFF).map((e) => e.game.id)).toEqual(['later']);
  });
});
