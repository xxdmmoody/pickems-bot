/** The four picks every player makes each week. */
export const CATEGORIES = ['OVER', 'UNDER', 'FAVORITE', 'UNDERDOG'] as const;
export type Category = (typeof CATEGORIES)[number];

/** OVER/UNDER pick a game; FAVORITE/UNDERDOG pick a team within a game. */
export function picksATeam(category: Category): boolean {
  return category === 'FAVORITE' || category === 'UNDERDOG';
}

/** ESPN's `status.type.state`. A game is pickable only while `pre`. */
export type GameState = 'pre' | 'in' | 'post';

export interface Game {
  /** ESPN event id. */
  readonly id: string;
  readonly season: number;
  readonly week: number;
  readonly awayAbbr: string;
  readonly homeAbbr: string;
  /** Kickoff as an epoch-millisecond timestamp (UTC). */
  readonly kickoff: number;
  readonly state: GameState;
  /** Present once the game has a score; null before kickoff. */
  readonly awayScore: number | null;
  readonly homeScore: number | null;
}

/**
 * A game's betting line.
 *
 * `spread` is HOME-RELATIVE and signed, matching ESPN's own convention:
 *   negative => home team favored (SEA -3.5 at home => -3.5)
 *   positive => away team favored (BAL -3.5 at IND  => +3.5)
 *   zero     => pick'em, no favorite or underdog
 *
 * Keeping ESPN's sign convention rather than storing a magnitude plus a
 * favorite abbreviation is what makes line-move detection a subtraction and a
 * favorite flip a sign change. See domain/lineMove.ts.
 */
export interface Line {
  readonly gameId: string;
  readonly season: number;
  readonly week: number;
  readonly overUnder: number;
  readonly spread: number;
  /** null on a true pick'em (spread === 0). */
  readonly favoriteAbbr: string | null;
  readonly underdogAbbr: string | null;
}

export interface Pick {
  readonly guildId: string;
  readonly userId: string;
  readonly season: number;
  readonly week: number;
  readonly category: Category;
  readonly gameId: string;
  /** The chosen team for FAVORITE/UNDERDOG; null for OVER/UNDER. */
  readonly teamAbbr: string | null;
}

/** Outcome of a single graded pick. A push is neither a win nor a loss. */
export type Outcome = 'WIN' | 'LOSS' | 'PUSH';

export interface WeekRecord {
  readonly userId: string;
  readonly wins: number;
  readonly losses: number;
  readonly pushes: number;
}

/** A game paired with its currently effective line. */
export interface GameWithLine {
  readonly game: Game;
  readonly line: Line;
}

export function favoriteOf(line: Line, game: Game): string | null {
  if (line.spread === 0) return null;
  return line.spread < 0 ? game.homeAbbr : game.awayAbbr;
}

export function underdogOf(line: Line, game: Game): string | null {
  if (line.spread === 0) return null;
  return line.spread < 0 ? game.awayAbbr : game.homeAbbr;
}

/** The favorite's spread as displayed, always negative, e.g. -7.5. */
export function favoriteSpread(line: Line): number {
  return -Math.abs(line.spread);
}

/** The underdog's spread as displayed, always positive, e.g. +7.5. */
export function underdogSpread(line: Line): number {
  return Math.abs(line.spread);
}
