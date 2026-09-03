import type { Category, Game, Pick } from './types.js';

/**
 * A game locks the moment it kicks off. ESPN's own state is authoritative when
 * it has moved past `pre` — that covers a kickoff running early or a game being
 * delayed — with the scheduled kickoff as the fallback between odds refreshes.
 */
export function isGameLocked(game: Game, now: number): boolean {
  return game.state !== 'pre' || now >= game.kickoff;
}

export type LockRejection =
  | { kind: 'GAME_STARTED'; gameId: string }
  | { kind: 'PICK_LOCKED'; category: Category; gameId: string };

/**
 * Decides whether `userId` may set `category` to `gameId` right now.
 *
 * Two separate rules, per the requirements:
 *  1. You cannot pick a game that has already started.
 *  2. You cannot *change* a pick whose game has already started — even to an
 *     unlocked game, because that pick is already in play.
 *
 * A player with an incomplete slate may still pick after other games have
 * kicked off; only the started games are off limits.
 */
export function checkLock(
  category: Category,
  targetGame: Game,
  existingPick: Pick | null,
  existingGame: Game | null,
  now: number
): LockRejection | null {
  if (existingPick && existingGame && isGameLocked(existingGame, now)) {
    return { kind: 'PICK_LOCKED', category, gameId: existingGame.id };
  }
  if (isGameLocked(targetGame, now)) {
    return { kind: 'GAME_STARTED', gameId: targetGame.id };
  }
  return null;
}

/** The games still selectable right now — what the pick dropdowns should offer. */
export function unlockedGames<T extends { game: Game }>(entries: readonly T[], now: number): T[] {
  return entries.filter((e) => !isGameLocked(e.game, now));
}
