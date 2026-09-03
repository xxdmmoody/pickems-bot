import { describe, expect, it } from 'vitest';
import { gradePick, gradeUserWeek } from './grading.js';
import type { Category, Game, Line, Pick } from './types.js';

/** ARI at BAL — away @ home. Spread is home-relative: negative = BAL favored. */
function game(awayScore: number | null, homeScore: number | null): Game {
  return {
    id: 'g1',
    season: 2026,
    week: 1,
    awayAbbr: 'ARI',
    homeAbbr: 'BAL',
    kickoff: Date.parse('2026-09-13T17:00:00Z'),
    state: awayScore === null ? 'pre' : 'post',
    awayScore,
    homeScore,
  };
}

function line(spread: number, overUnder: number): Line {
  return {
    gameId: 'g1',
    season: 2026,
    week: 1,
    overUnder,
    spread,
    favoriteAbbr: spread === 0 ? null : spread < 0 ? 'BAL' : 'ARI',
    underdogAbbr: spread === 0 ? null : spread < 0 ? 'ARI' : 'BAL',
  };
}

function pick(category: Category, teamAbbr: string | null = null): Pick {
  return { guildId: 'g', userId: 'u', season: 2026, week: 1, category, gameId: 'g1', teamAbbr };
}

describe('totals', () => {
  it('grades an over that hits', () => {
    // 37 + 21 = 58 > 46.5
    expect(gradePick(pick('OVER'), game(37, 21), line(-7.5, 46.5))).toBe('WIN');
  });

  it('grades an over that misses', () => {
    expect(gradePick(pick('OVER'), game(10, 13), line(-7.5, 46.5))).toBe('LOSS');
  });

  it('grades an under that hits', () => {
    expect(gradePick(pick('UNDER'), game(10, 13), line(-7.5, 46.5))).toBe('WIN');
  });

  it('treats an exact total as a push, not a loss', () => {
    // 24 + 22 = 46 on a 46.0 total
    expect(gradePick(pick('OVER'), game(24, 22), line(-7.5, 46))).toBe('PUSH');
    expect(gradePick(pick('UNDER'), game(24, 22), line(-7.5, 46))).toBe('PUSH');
  });
});

describe('spreads', () => {
  it('grades a home favorite that covers', () => {
    // BAL -7.5, wins by 10
    expect(gradePick(pick('FAVORITE', 'BAL'), game(14, 24), line(-7.5, 46.5))).toBe('WIN');
  });

  it('grades a home favorite that wins but fails to cover', () => {
    // BAL -7.5, wins by only 3
    expect(gradePick(pick('FAVORITE', 'BAL'), game(21, 24), line(-7.5, 46.5))).toBe('LOSS');
  });

  it('grades an underdog that covers by losing close', () => {
    // ARI +7.5, loses by 3
    expect(gradePick(pick('UNDERDOG', 'ARI'), game(21, 24), line(-7.5, 46.5))).toBe('WIN');
  });

  it('grades an underdog that wins outright', () => {
    expect(gradePick(pick('UNDERDOG', 'ARI'), game(30, 24), line(-7.5, 46.5))).toBe('WIN');
  });

  it('grades an away favorite that covers', () => {
    // spread +3.5 => ARI (away) favored by 3.5; ARI wins by 7
    expect(gradePick(pick('FAVORITE', 'ARI'), game(28, 21), line(3.5, 46.5))).toBe('WIN');
  });

  it('treats an exact spread as a push on both sides', () => {
    // BAL -3, wins by exactly 3
    expect(gradePick(pick('FAVORITE', 'BAL'), game(21, 24), line(-3, 46.5))).toBe('PUSH');
    expect(gradePick(pick('UNDERDOG', 'ARI'), game(21, 24), line(-3, 46.5))).toBe('PUSH');
  });

  it('pushes a spread pick on a game that became a pick-em', () => {
    expect(gradePick(pick('FAVORITE', 'BAL'), game(21, 24), line(0, 46.5))).toBe('PUSH');
  });

  it('grades the team the player chose even after the line flipped sides', () => {
    // Picked BAL as the favorite at -3. The line flipped to ARI -2.5 (spread
    // +2.5), so BAL is now the underdog. BAL loses by 1, covering as a dog.
    expect(gradePick(pick('FAVORITE', 'BAL'), game(24, 23), line(2.5, 46.5))).toBe('WIN');
  });

  it('rejects grading a game with no final score', () => {
    expect(() => gradePick(pick('OVER'), game(null, null), line(-7.5, 46.5))).toThrow(/no final score/);
  });
});

describe('gradeUserWeek', () => {
  const games = new Map([['g1', game(37, 21)]]);
  const lines = new Map([['g1', line(-7.5, 46.5)]]);

  it('counts every missing pick as a loss', () => {
    const { record } = gradeUserWeek('u', [], games, lines);
    expect(record).toEqual({ userId: 'u', wins: 0, losses: 4, pushes: 0 });
  });

  it('counts a partial slate as wins plus losses for the gaps', () => {
    // ARI 37 BAL 21: total 58 clears 46.5, and ARI (+7.5 dog) wins outright.
    const picks = [pick('OVER'), pick('UNDERDOG', 'ARI')];
    const { record } = gradeUserWeek('u', picks, games, lines);
    expect(record).toEqual({ userId: 'u', wins: 2, losses: 2, pushes: 0 });
  });

  it('separates pushes from wins and losses', () => {
    // ARI 37 BAL 21: the total lands exactly on 58, and ARI as a 16-point away
    // favorite (spread +16) wins by exactly 16 — both picks push.
    const pushLines = new Map([['g1', line(16, 58)]]);
    const picks = [pick('OVER'), pick('FAVORITE', 'ARI')];
    const { record } = gradeUserWeek('u', picks, new Map([['g1', game(37, 21)]]), pushLines);
    expect(record).toEqual({ userId: 'u', wins: 0, losses: 2, pushes: 2 });
  });

  it('leaves picks on unfinished games ungraded so a week can be re-graded', () => {
    const pending = new Map([['g1', game(null, null)]]);
    const { record, graded } = gradeUserWeek('u', [pick('OVER')], pending, lines);
    // Only the three missing categories count; the pending pick is skipped.
    expect(record).toEqual({ userId: 'u', wins: 0, losses: 3, pushes: 0 });
    expect(graded.some((g) => g.category === 'OVER')).toBe(false);
  });
});
