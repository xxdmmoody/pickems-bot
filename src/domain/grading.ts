import type { Category, Game, Line, Outcome, Pick, WeekRecord } from './types.js';
import { CATEGORIES, favoriteOf, underdogOf } from './types.js';

/**
 * Grades one pick against the line that was in effect for its game.
 *
 * Confirmed rules:
 *  - A push (the number landing exactly) is neither a win nor a loss.
 *  - A missing pick is a loss — see `gradeWeek`, which supplies the losses for
 *    categories the player never filled in.
 */
export function gradePick(pick: Pick, game: Game, line: Line): Outcome {
  if (game.awayScore === null || game.homeScore === null) {
    throw new Error(`Cannot grade ${pick.category}: game ${game.id} has no final score`);
  }

  switch (pick.category) {
    case 'OVER':
    case 'UNDER':
      return gradeTotal(pick.category, game.awayScore + game.homeScore, line.overUnder);
    case 'FAVORITE':
    case 'UNDERDOG':
      return gradeSpread(pick, game, line);
  }
}

function gradeTotal(category: 'OVER' | 'UNDER', total: number, overUnder: number): Outcome {
  if (total === overUnder) return 'PUSH';
  const wentOver = total > overUnder;
  return wentOver === (category === 'OVER') ? 'WIN' : 'LOSS';
}

function gradeSpread(pick: Pick, game: Game, line: Line): Outcome {
  // A pick'em has no favorite or underdog, so a pick on it cannot be graded
  // either way. Treat it as a push rather than punishing the player for a line
  // that moved to zero after they picked.
  if (line.spread === 0) return 'PUSH';

  const favorite = favoriteOf(line, game);
  const underdog = underdogOf(line, game);
  const expected = pick.category === 'FAVORITE' ? favorite : underdog;

  // The line can move sides after a pick is made (a favorite flip). The pick is
  // bound to the team the player chose, so grade that team on whichever side of
  // the spread it now occupies.
  if (pick.teamAbbr !== expected) {
    return gradeFlippedPick(pick, game, line);
  }

  const margin = marginFor(pick.teamAbbr, game);
  const cushion = pick.category === 'FAVORITE' ? -Math.abs(line.spread) : Math.abs(line.spread);
  return compare(margin + cushion);
}

/**
 * The player's team is no longer on the side they picked it for (the line
 * flipped). Grade the team against the current spread from its own perspective:
 * it either covers or it doesn't, regardless of which label it now carries.
 */
function gradeFlippedPick(pick: Pick, game: Game, line: Line): Outcome {
  if (pick.teamAbbr === null) return 'PUSH';
  const isFavoriteNow = pick.teamAbbr === favoriteOf(line, game);
  const cushion = isFavoriteNow ? -Math.abs(line.spread) : Math.abs(line.spread);
  return compare(marginFor(pick.teamAbbr, game) + cushion);
}

/** Points scored minus points allowed, from `abbr`'s perspective. */
function marginFor(abbr: string | null, game: Game): number {
  if (game.awayScore === null || game.homeScore === null) {
    throw new Error(`Game ${game.id} has no final score`);
  }
  if (abbr === game.homeAbbr) return game.homeScore - game.awayScore;
  if (abbr === game.awayAbbr) return game.awayScore - game.homeScore;
  throw new Error(`Team ${abbr} is not in game ${game.id}`);
}

function compare(adjustedMargin: number): Outcome {
  if (adjustedMargin === 0) return 'PUSH';
  return adjustedMargin > 0 ? 'WIN' : 'LOSS';
}

export interface GradedPick {
  readonly category: Category;
  readonly outcome: Outcome;
  /** null when the player never made this pick. */
  readonly pick: Pick | null;
}

/**
 * Grades a single player's week across all four categories.
 *
 * Categories with no pick count as losses. A game with no final score yet is
 * skipped entirely (neither win, loss, nor push) so a week can be graded
 * partially and re-graded later without double-counting.
 */
export function gradeUserWeek(
  userId: string,
  picks: readonly Pick[],
  games: ReadonlyMap<string, Game>,
  lines: ReadonlyMap<string, Line>
): { record: WeekRecord; graded: GradedPick[] } {
  const byCategory = new Map(picks.map((p) => [p.category, p]));
  const graded: GradedPick[] = [];
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const category of CATEGORIES) {
    const pick = byCategory.get(category);

    if (!pick) {
      losses += 1;
      graded.push({ category, outcome: 'LOSS', pick: null });
      continue;
    }

    const game = games.get(pick.gameId);
    const line = lines.get(pick.gameId);
    if (!game || !line || game.awayScore === null || game.homeScore === null) {
      continue; // Not final yet — leave it ungraded.
    }

    const outcome = gradePick(pick, game, line);
    if (outcome === 'WIN') wins += 1;
    else if (outcome === 'LOSS') losses += 1;
    else pushes += 1;
    graded.push({ category, outcome, pick });
  }

  return { record: { userId, wins, losses, pushes }, graded };
}
