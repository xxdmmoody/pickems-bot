import { DateTime } from 'luxon';
import type { EspnClient } from '../espn/client.js';
import { parseScoreboard, type ParsedWeek } from '../espn/mapper.js';
import { logger } from '../logger.js';
import type { Repos } from '../db/repos.js';
import { joinGamesAndLines } from '../db/repos.js';
import type { GameWithLine } from '../domain/types.js';

/** The regular season the requirements cover. */
export const FIRST_WEEK = 1;
export const LAST_WEEK = 18;

/**
 * Reads the schedule and lines for a week from ESPN and stores them.
 *
 * Games are always refreshed (scores, state, flexed kickoffs). Lines are only
 * *snapshotted* — an existing line is never overwritten here, because the
 * number people saw when they picked must not change silently. The one path
 * that does change a line is the line watcher, which also records an audit row
 * and alerts the affected players.
 */
export async function syncWeek(
  espn: EspnClient,
  repos: Repos,
  season: number,
  week: number
): Promise<ParsedWeek> {
  const parsed = parseScoreboard(await espn.scoreboard(season, week));

  repos.games.upsertMany(parsed.games);
  repos.lines.snapshotMany(parsed.lines);

  const missingLines = parsed.games.length - parsed.lines.length;
  if (missingLines > 0) {
    logger.warn(
      { season, week, missingLines },
      'ESPN returned no line for some games; they will be excluded from picks until it does'
    );
  }

  return parsed;
}

/** Whatever week ESPN currently considers live — used to seed jobs. */
export async function currentWeek(espn: EspnClient): Promise<{ season: number; week: number }> {
  const parsed = parseScoreboard(await espn.currentScoreboard());
  return { season: parsed.season, week: parsed.week };
}

/** The stored week, joined and ready to render. */
export function loadWeek(repos: Repos, season: number, week: number): GameWithLine[] {
  return joinGamesAndLines(repos.games.byWeek(season, week), repos.lines.byWeek(season, week));
}

/** Teams with no game this week, recomputed from what is stored. */
export function byeTeams(repos: Repos, season: number, week: number, allAbbrs: readonly string[]): string[] {
  const playing = new Set<string>();
  for (const game of repos.games.byWeek(season, week)) {
    playing.add(game.awayAbbr);
    playing.add(game.homeAbbr);
  }
  return allAbbrs.filter((abbr) => !playing.has(abbr));
}

/**
 * "Sun 12:00 PM CDT" — how deadlines are written in alerts and lock errors.
 *
 * Uses the guild's configured zone and its own abbreviation rather than
 * hardcoding CT, so a guild on a different timezone reads correctly, and CST/CDT
 * stays honest across the November changeover.
 */
export function formatKickoff(kickoff: number, timezone: string): string {
  const dt = DateTime.fromMillis(kickoff, { zone: timezone });
  return `${dt.toFormat('ccc h:mm a')} ${dt.toFormat('ZZZZ')}`;
}
