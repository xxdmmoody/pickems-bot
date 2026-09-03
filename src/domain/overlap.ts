import type { Category, Pick } from './types.js';

export interface OverlapConflict {
  /** The category already using this game. */
  readonly conflictingCategory: Category;
  readonly gameId: string;
}

/**
 * All four of a player's picks must be on four distinct games.
 *
 * This enforces every restriction chosen during planning at once: the same game
 * can't be used for both OVER and UNDER, both sides of one game can't be taken
 * as FAVORITE and UNDERDOG, and an over/under game can't double as a spread
 * game.
 *
 * The pick messages are shared by the whole server, so the dropdowns can't be
 * filtered per user — this runs at selection time instead and the caller turns
 * the conflict into an ephemeral explanation.
 */
export function findOverlap(
  category: Category,
  gameId: string,
  existingPicks: readonly Pick[]
): OverlapConflict | null {
  for (const pick of existingPicks) {
    // Re-selecting within the same category is a change, not a conflict.
    if (pick.category === category) continue;
    if (pick.gameId === gameId) {
      return { conflictingCategory: pick.category, gameId };
    }
  }
  return null;
}

/** Game ids already spoken for by categories other than `category`. */
export function gamesInUse(category: Category, existingPicks: readonly Pick[]): Set<string> {
  const used = new Set<string>();
  for (const pick of existingPicks) {
    if (pick.category !== category) used.add(pick.gameId);
  }
  return used;
}
