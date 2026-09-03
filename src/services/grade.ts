import type { Repos } from '../db/repos.js';
import { gradeUserWeek } from '../domain/grading.js';
import type { Game, Line, Pick, WeekRecord } from '../domain/types.js';
import { logger } from '../logger.js';

export interface GradeSummary {
  readonly week: number;
  readonly records: WeekRecord[];
  /** Games still without a final score — the week can be re-graded later. */
  readonly ungradedGames: number;
}

/**
 * Grades a week for one guild and stores the records.
 *
 * Every participant is graded, not just those who picked, because a missing
 * pick counts as a loss. `participantIds` therefore decides who appears in the
 * results — anyone holding the role, plus anyone who made a pick (someone who
 * picked and then lost the role should still see their week).
 */
export function gradeWeek(
  repos: Repos,
  guildId: string,
  season: number,
  week: number,
  participantIds: readonly string[]
): GradeSummary {
  const games = new Map<string, Game>(repos.games.byWeek(season, week).map((g) => [g.id, g]));
  const lines = new Map<string, Line>(repos.lines.byWeek(season, week).map((l) => [l.gameId, l]));

  const picksByUser = new Map<string, Pick[]>();
  for (const pick of repos.picks.forWeek(guildId, season, week)) {
    const list = picksByUser.get(pick.userId) ?? [];
    list.push(pick);
    picksByUser.set(pick.userId, list);
  }

  const everyone = new Set<string>([...participantIds, ...picksByUser.keys()]);
  const records: WeekRecord[] = [];

  for (const userId of everyone) {
    const { record } = gradeUserWeek(userId, picksByUser.get(userId) ?? [], games, lines);
    records.push(record);
  }

  const ungradedGames = [...games.values()].filter((g) => g.awayScore === null).length;
  if (ungradedGames > 0) {
    logger.warn({ season, week, ungradedGames }, 'grading a week with games still unfinished');
  }

  repos.results.saveWeek(guildId, season, week, records);
  return { week, records, ungradedGames };
}
