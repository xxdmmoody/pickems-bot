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

/**
 * The week the Tuesday job should open, and its synced data.
 *
 * ESPN does not roll its "current week" over the instant a week ends — on a
 * Tuesday it can still be reporting the week whose last game finished on Monday
 * night. Taking that number at face value would re-post the week just played and
 * leave the new one unopened until the following Tuesday, quietly costing a week
 * of the season. So when every game of ESPN's current week has already kicked
 * off, advance to the next one.
 */
export async function resolveWeekToOpen(
  espn: EspnClient,
  repos: Repos
): Promise<{ season: number; week: number }> {
  const live = await currentWeek(espn);
  const parsed = await syncWeek(espn, repos, live.season, live.week);

  const everyGameStarted = parsed.games.length > 0 && parsed.games.every((g) => g.state !== 'pre');
  if (everyGameStarted && live.week < LAST_WEEK) {
    return { season: live.season, week: live.week + 1 };
  }

  return live;
}

/**
 * Whether any game is due within `windowMs` of `now` and has not started.
 *
 * This is what makes "the night before each game day" mean the actual schedule
 * rather than a hardcoded set of weekdays. NFL weeks are not uniform: 2026 opens
 * on a Wednesday, late-season weeks add Saturday games, and there are Friday and
 * holiday games — all of which a fixed Wed/Sat/Sun cron would miss entirely.
 */
export function hasGamesWithin(
  repos: Repos,
  season: number,
  week: number,
  now: number,
  windowMs = 24 * 60 * 60 * 1000
): boolean {
  return repos.games
    .byWeek(season, week)
    .some((game) => game.state === 'pre' && game.kickoff > now && game.kickoff <= now + windowMs);
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
