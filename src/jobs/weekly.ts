import type { Client } from 'discord.js';
import type { GuildConfig, Repos } from '../db/repos.js';
import type { EspnClient } from '../espn/client.js';
import { logger } from '../logger.js';
import { renderNudge } from '../render/results.js';
import { gradeWeek } from '../services/grade.js';
import { participantIds } from '../services/participants.js';
import { findIncomplete } from '../services/picks.js';
import { announce, postRecap, postResultsAndStandings, postWeek, refreshPickMessages } from '../services/poster.js';
import { resolveWeekToOpen, syncWeek, FIRST_WEEK, LAST_WEEK } from '../services/week.js';

export interface JobContext {
  client: Client;
  repos: Repos;
  espn: EspnClient;
}

/**
 * The Tuesday 12:00 CT job, in the order the requirements lay out:
 *
 *   1. grade last week against the snapshotted lines
 *   2. post the weekly results
 *   3. post the season standings
 *   4. post the recap of last week's games
 *   5. fetch and snapshot this week's schedule and lines
 *   6. post the schedule
 *   7. post the four pick messages, tagging the participant role
 *
 * Grading comes first so that the results and standings people read at the top
 * of the message burst already include last week.
 */
export async function runOpenWeek(ctx: JobContext, overrideWeek?: number): Promise<void> {
  const target = await resolveWeekToOpen(ctx.espn, ctx.repos);
  const season = target.season;
  const week = overrideWeek ?? target.week;

  if (week < FIRST_WEEK || week > LAST_WEEK) {
    logger.info({ season, week }, 'outside the regular season; skipping open-week job');
    return;
  }

  const guilds = ctx.repos.guilds.listActive();
  if (guilds.length === 0) {
    logger.info('no configured guilds; skipping open-week job');
    return;
  }

  const previousWeek = week - 1;
  if (previousWeek >= FIRST_WEEK) {
    // Refresh last week's finals before grading.
    await syncWeek(ctx.espn, ctx.repos, season, previousWeek);
  }

  await syncWeek(ctx.espn, ctx.repos, season, week);

  for (const config of guilds) {
    try {
      await openWeekForGuild(ctx, config, season, week, previousWeek);
    } catch (error) {
      // One misconfigured guild must not stop the others.
      logger.error({ guildId: config.guildId, err: String(error) }, 'open-week job failed for guild');
    }
  }
}

async function openWeekForGuild(
  ctx: JobContext,
  config: GuildConfig,
  season: number,
  week: number,
  previousWeek: number
): Promise<void> {
  if (previousWeek >= FIRST_WEEK) {
    const participants = await participantIds(ctx.client, config);
    gradeWeek(ctx.repos, config.guildId, season, previousWeek, participants);

    await postResultsAndStandings(ctx.client, ctx.repos, config, season, previousWeek);
    await postRecap(ctx.client, ctx.repos, config, season, previousWeek);
  }

  // An admin who already ran /openweek manually — as they must for the first
  // week of a season, since the Tuesday job has usually passed by then — should
  // not get a duplicate set of pick messages when the cron next fires. The
  // second set would carry its own dropdowns, and picks made on the stale
  // message would still save, so this is about clarity as much as tidiness.
  if (ctx.repos.messages.get(config.guildId, season, week, 'SCHEDULE')) {
    logger.info({ guildId: config.guildId, season, week }, 'week already posted; not posting again');
    return;
  }

  await postWeek(ctx.client, ctx.repos, config, season, week);
  logger.info({ guildId: config.guildId, season, week }, 'posted week');
}

/** The Thursday and Sunday nudges for anyone still incomplete. */
export async function runNudge(ctx: JobContext): Promise<void> {
  const target = ctx.repos.games.latestWeek();
  if (!target) return;

  for (const config of ctx.repos.guilds.listActive()) {
    try {
      const participants = await participantIds(ctx.client, config);
      const incomplete = findIncomplete(
        ctx.repos,
        config.guildId,
        target.season,
        target.week,
        participants
      );

      // Say nothing when everyone is done — a "well done everyone" ping every
      // Thursday and Sunday would train people to mute the channel.
      if (incomplete.length === 0) {
        logger.info({ guildId: config.guildId }, 'everyone has picked; skipping nudge');
        continue;
      }

      await announce(ctx.client, config, renderNudge(target.week, incomplete));
    } catch (error) {
      logger.error({ guildId: config.guildId, err: String(error) }, 'nudge failed for guild');
    }
  }
}

/**
 * Rewrites the pick dropdowns so options for games that just kicked off
 * disappear. Selection is validated server-side regardless, so this is a
 * usability measure rather than the enforcement itself.
 */
export async function runLockRefresh(ctx: JobContext, now = Date.now()): Promise<void> {
  const target = ctx.repos.games.latestWeek();
  if (!target) return;

  for (const config of ctx.repos.guilds.listActive()) {
    try {
      await refreshPickMessages(ctx.client, ctx.repos, config, target.season, target.week, now);
    } catch (error) {
      logger.error({ guildId: config.guildId, err: String(error) }, 'lock refresh failed for guild');
    }
  }
}

/** Pulls fresh scores so `/standings` and the recap reflect games as they finish. */
export async function runScoreRefresh(ctx: JobContext): Promise<void> {
  const target = ctx.repos.games.latestWeek();
  if (!target) return;

  ctx.espn.clearCache();
  await syncWeek(ctx.espn, ctx.repos, target.season, target.week);
}
