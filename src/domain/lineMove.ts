import type { Line } from './types.js';

/** A move of this many points in the spread or the total is worth alerting on. */
export const SIGNIFICANT_POINTS = 3;

export interface LineMove {
  readonly gameId: string;
  readonly oldLine: Line;
  readonly newLine: Line;
  readonly spreadDelta: number;
  readonly totalDelta: number;
  /** The favorite and underdog swapped sides — the spread crossed zero. */
  readonly flipped: boolean;
  readonly reasons: MoveReason[];
}

export type MoveReason = 'SPREAD' | 'TOTAL' | 'FLIP';

/**
 * Detects whether a re-fetched line has moved enough to re-open the week for a
 * game. Returns null when nothing significant changed.
 *
 * Because `spread` is home-relative and signed (see types.ts), the swing is a
 * plain subtraction and a favorite flip is a sign change — no need to reason
 * about which team the number belongs to.
 */
export function detectMove(oldLine: Line, newLine: Line): LineMove | null {
  const spreadDelta = round1(newLine.spread - oldLine.spread);
  const totalDelta = round1(newLine.overUnder - oldLine.overUnder);
  const flipped = hasFlipped(oldLine.spread, newLine.spread);

  const reasons: MoveReason[] = [];
  if (Math.abs(spreadDelta) >= SIGNIFICANT_POINTS) reasons.push('SPREAD');
  if (Math.abs(totalDelta) >= SIGNIFICANT_POINTS) reasons.push('TOTAL');
  if (flipped) reasons.push('FLIP');

  if (reasons.length === 0) return null;

  return {
    gameId: newLine.gameId,
    oldLine,
    newLine,
    spreadDelta,
    totalDelta,
    flipped,
    reasons,
  };
}

/**
 * True when the favored side changed. A spread of exactly zero is a pick'em with
 * no favorite at all — moving to or from it isn't a flip between two teams, so
 * it only counts when the sign genuinely crosses from one side to the other.
 */
function hasFlipped(oldSpread: number, newSpread: number): boolean {
  if (oldSpread === 0 || newSpread === 0) return false;
  return Math.sign(oldSpread) !== Math.sign(newSpread);
}

/**
 * Lines are quoted in half points, so floating-point subtraction can leave
 * artefacts like 4.499999999999999. One decimal place is more than enough
 * precision and keeps the alert text clean.
 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
