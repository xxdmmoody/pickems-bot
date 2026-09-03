import { groupByRecord, rank, type SeasonRecord } from '../domain/standings.js';
import type { WeekRecord } from '../domain/types.js';
import { bold, joinLines, mention } from './format.js';

/**
 * The weekly results message, grouped by the record players actually posted:
 *
 *   Last week's results:
 *   4-0: @USER1, @USER2
 *   3-1: @USER3
 *   2-2: @USER4, @USER7
 *
 * Tiers nobody reached are omitted. Because a push is neither a win nor a loss,
 * records like 3-0 can appear alongside 3-1; they sort by wins, then by fewest
 * losses. On a week with no pushes this collapses to exactly the five tiers in
 * the requirements.
 */
export function renderResults(week: number, weekly: readonly WeekRecord[]): string {
  if (weekly.length === 0) {
    return `${bold(`Week ${week} results`)}\n\n_Nobody made any picks._`;
  }

  const rows = groupByRecord(weekly).map((group) => {
    const names = group.userIds.map(mention).join(', ');
    const pushNote = group.pushes > 0 ? ` _(${group.pushes} push${group.pushes === 1 ? '' : 'es'})_` : '';
    return `${bold(`${group.wins}-${group.losses}`)}${pushNote}: ${names}`;
  });

  return joinLines([bold(`Week ${week} results`), '', ...rows]);
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * The season standings, best to worst:
 *
 *   🥇 @User1 - 15-4
 *   🥈 @User2 - 13-6
 *   🥉 @User3 - 10-9
 *   @User4 - 5-14
 *
 * Every participant is listed. Tied players share a medal, and pushes are shown
 * only when a player has any, so the common case reads as a clean W-L.
 */
export function renderStandings(season: number, records: readonly SeasonRecord[]): string {
  if (records.length === 0) {
    return `${bold(`${season} standings`)}\n\n_No picks have been graded yet._`;
  }

  const rows = rank(records).map((r) => {
    const medal = r.rank <= MEDALS.length ? `${MEDALS[r.rank - 1]} ` : '';
    const pushes = r.pushes > 0 ? `-${r.pushes}` : '';
    return `${medal}${mention(r.userId)} - ${r.wins}-${r.losses}${pushes}`;
  });

  return joinLines([bold(`${season} standings`), '', ...rows]);
}

/**
 * The Thursday and Sunday nudge. Names each player and the picks they still owe
 * so the message is actionable without opening anything.
 */
export function renderNudge(
  week: number,
  missing: readonly { userId: string; categories: readonly string[] }[]
): string {
  if (missing.length === 0) {
    return `Everyone is locked in for Week ${week}. 🏈`;
  }

  const rows = missing.map(
    ({ userId, categories }) => `${mention(userId)} — still needs: ${categories.join(', ')}`
  );

  return joinLines([
    bold(`Week ${week} picks are still open`),
    '',
    ...rows,
    '',
    '_Picks lock at each game\'s kickoff._',
  ]);
}
