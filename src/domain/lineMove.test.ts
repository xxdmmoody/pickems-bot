import { describe, expect, it } from 'vitest';
import { detectMove } from './lineMove.js';
import type { Line } from './types.js';

function line(spread: number, overUnder: number): Line {
  return {
    gameId: 'g1',
    season: 2026,
    week: 1,
    overUnder,
    spread,
    favoriteAbbr: spread === 0 ? null : spread < 0 ? 'MIA' : 'BAL',
    underdogAbbr: spread === 0 ? null : spread < 0 ? 'BAL' : 'MIA',
  };
}

describe('spread swings', () => {
  it('ignores a 2.5 point move', () => {
    expect(detectMove(line(-7, 46.5), line(-4.5, 46.5))).toBeNull();
  });

  it('flags a move of exactly 3', () => {
    const move = detectMove(line(-7, 46.5), line(-4, 46.5));
    expect(move?.reasons).toEqual(['SPREAD']);
    expect(move?.spreadDelta).toBe(3);
  });

  it('flags a 3.5 point move', () => {
    expect(detectMove(line(-7, 46.5), line(-3.5, 46.5))?.reasons).toContain('SPREAD');
  });

  it('flags a move in either direction', () => {
    const widened = detectMove(line(-3, 46.5), line(-7, 46.5));
    expect(widened?.spreadDelta).toBe(-4);
    expect(widened?.reasons).toContain('SPREAD');
  });
});

describe('total swings', () => {
  it('ignores a 2.5 point move', () => {
    expect(detectMove(line(-7, 46.5), line(-7, 44))).toBeNull();
  });

  it('flags a move of exactly 3', () => {
    const move = detectMove(line(-7, 46.5), line(-7, 43.5));
    expect(move?.reasons).toEqual(['TOTAL']);
    expect(move?.totalDelta).toBe(-3);
  });
});

describe('favorite flips', () => {
  it('flags a flip smaller than the point threshold', () => {
    // MIA -1.5 becomes BAL -1: only a 2.5 point move, but the sides swapped.
    const move = detectMove(line(-1.5, 46.5), line(1, 46.5));
    expect(move?.flipped).toBe(true);
    expect(move?.reasons).toEqual(['FLIP']);
  });

  it('reports both a flip and a spread swing when the move is large', () => {
    const move = detectMove(line(-3, 46.5), line(2, 46.5));
    expect(move?.reasons).toEqual(['SPREAD', 'FLIP']);
  });

  it('does not treat a move to a pick-em as a flip', () => {
    // No favorite exists at 0, so there is nothing to flip between.
    expect(detectMove(line(-1.5, 46.5), line(0, 46.5))).toBeNull();
  });

  it('does not treat a move off a pick-em as a flip', () => {
    expect(detectMove(line(0, 46.5), line(1.5, 46.5))).toBeNull();
  });
});

describe('numeric hygiene', () => {
  it('returns null when nothing changed', () => {
    expect(detectMove(line(-7, 46.5), line(-7, 46.5))).toBeNull();
  });

  it('rounds away floating-point artefacts in the deltas', () => {
    // 46.5 - 43.4 is 3.0999999999999996 in IEEE754.
    const move = detectMove(line(-7, 46.5), line(-7, 43.4));
    expect(move?.totalDelta).toBe(-3.1);
  });

  it('detects both triggers at once', () => {
    const move = detectMove(line(-7, 46.5), line(-3, 41));
    expect(move?.reasons).toEqual(['SPREAD', 'TOTAL']);
  });
});
