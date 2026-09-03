import { describe, expect, it } from 'vitest';
import { findOverlap, gamesInUse } from './overlap.js';
import type { Category, Pick } from './types.js';

function pick(category: Category, gameId: string, teamAbbr: string | null = null): Pick {
  return { guildId: 'g', userId: 'u', season: 2026, week: 1, category, gameId, teamAbbr };
}

describe('findOverlap', () => {
  it('allows a game nobody else is using', () => {
    expect(findOverlap('UNDER', 'g2', [pick('OVER', 'g1')])).toBeNull();
  });

  it('blocks taking the over and the under on the same game', () => {
    expect(findOverlap('UNDER', 'g1', [pick('OVER', 'g1')])).toEqual({
      conflictingCategory: 'OVER',
      gameId: 'g1',
    });
  });

  it('blocks taking both sides of one game as favorite and underdog', () => {
    const existing = [pick('FAVORITE', 'g1', 'BAL')];
    expect(findOverlap('UNDERDOG', 'g1', existing)).toEqual({
      conflictingCategory: 'FAVORITE',
      gameId: 'g1',
    });
  });

  it('blocks reusing an over/under game for a spread pick', () => {
    expect(findOverlap('FAVORITE', 'g1', [pick('OVER', 'g1')])).toEqual({
      conflictingCategory: 'OVER',
      gameId: 'g1',
    });
  });

  it('treats re-selecting within the same category as a change, not a conflict', () => {
    expect(findOverlap('OVER', 'g1', [pick('OVER', 'g1')])).toBeNull();
  });

  it('reports the first conflicting category when a full slate exists', () => {
    const slate = [
      pick('OVER', 'g1'),
      pick('UNDER', 'g2'),
      pick('FAVORITE', 'g3', 'BAL'),
      pick('UNDERDOG', 'g4', 'ARI'),
    ];
    expect(findOverlap('OVER', 'g3', slate)?.conflictingCategory).toBe('FAVORITE');
  });
});

describe('gamesInUse', () => {
  it('excludes the category being set so it can be changed freely', () => {
    const slate = [pick('OVER', 'g1'), pick('UNDER', 'g2'), pick('FAVORITE', 'g3', 'BAL')];
    expect([...gamesInUse('OVER', slate)].sort()).toEqual(['g2', 'g3']);
  });
});
