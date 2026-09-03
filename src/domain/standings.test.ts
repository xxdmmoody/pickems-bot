import { describe, expect, it } from 'vitest';
import { accumulate, groupByRecord, rank } from './standings.js';
import type { WeekRecord } from './types.js';

const w = (userId: string, wins: number, losses: number, pushes = 0): WeekRecord => ({
  userId,
  wins,
  losses,
  pushes,
});

describe('accumulate', () => {
  it('sums a season across weeks', () => {
    const totals = accumulate([w('u1', 4, 0), w('u1', 2, 2), w('u2', 1, 3)]);
    expect(totals).toContainEqual({ userId: 'u1', wins: 6, losses: 2, pushes: 0 });
    expect(totals).toContainEqual({ userId: 'u2', wins: 1, losses: 3, pushes: 0 });
  });

  it('carries pushes through without folding them into wins or losses', () => {
    expect(accumulate([w('u1', 3, 0, 1)])).toEqual([{ userId: 'u1', wins: 3, losses: 0, pushes: 1 }]);
  });
});

describe('rank', () => {
  it('orders by wins, then fewest losses', () => {
    const ranked = rank([
      { userId: 'u3', wins: 10, losses: 9, pushes: 0 },
      { userId: 'u1', wins: 15, losses: 4, pushes: 0 },
      { userId: 'u2', wins: 13, losses: 6, pushes: 0 },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(['u1', 'u2', 'u3']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('separates equal wins by losses, so fewer pushes does not outrank', () => {
    // 8-2 (2 pushes) beats 8-4 despite the same win count.
    const ranked = rank([
      { userId: 'a', wins: 8, losses: 4, pushes: 0 },
      { userId: 'b', wins: 8, losses: 2, pushes: 2 },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(['b', 'a']);
  });

  it('gives tied players the same rank and skips the next', () => {
    const ranked = rank([
      { userId: 'a', wins: 10, losses: 2, pushes: 0 },
      { userId: 'b', wins: 10, losses: 2, pushes: 0 },
      { userId: 'c', wins: 5, losses: 7, pushes: 0 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('is deterministic for identical records', () => {
    const records = [
      { userId: 'zeta', wins: 1, losses: 1, pushes: 0 },
      { userId: 'alpha', wins: 1, losses: 1, pushes: 0 },
    ];
    expect(rank(records).map((r) => r.userId)).toEqual(['alpha', 'zeta']);
  });
});

describe('groupByRecord', () => {
  it('produces the five classic tiers when nobody pushed', () => {
    const groups = groupByRecord([
      w('u1', 4, 0),
      w('u2', 4, 0),
      w('u3', 3, 1),
      w('u4', 2, 2),
      w('u5', 1, 3),
      w('u6', 0, 4),
      w('u7', 2, 2),
    ]);
    expect(groups.map((g) => `${g.wins}-${g.losses}`)).toEqual(['4-0', '3-1', '2-2', '1-3', '0-4']);
    expect(groups[0]?.userIds).toEqual(['u1', 'u2']);
    expect(groups[2]?.userIds).toEqual(['u4', 'u7']);
  });

  it('omits tiers nobody reached', () => {
    const groups = groupByRecord([w('u1', 4, 0), w('u2', 2, 2)]);
    expect(groups.map((g) => `${g.wins}-${g.losses}`)).toEqual(['4-0', '2-2']);
  });

  it('slots push-shortened records between the full ones', () => {
    // 3-0 (one push) outranks 3-1 on fewer losses.
    const groups = groupByRecord([w('u1', 4, 0), w('u2', 3, 1), w('u3', 3, 0, 1)]);
    expect(groups.map((g) => `${g.wins}-${g.losses}`)).toEqual(['4-0', '3-0', '3-1']);
  });
});
