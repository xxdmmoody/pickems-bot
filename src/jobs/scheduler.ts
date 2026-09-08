import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../logger.js';
import { currentWeek, hasGamesWithin } from '../services/week.js';
import { runLineWatch } from './lineWatch.js';
import { runLockRefresh, runNudge, runOpenWeek, runScoreRefresh, type JobContext } from './weekly.js';

/**
 * All recurring work, in the guild-default timezone.
 *
 * node-cron applies the timezone itself, so these fire at the stated local time
 * on both sides of the daylight-saving change rather than drifting an hour in
 * November — which matters when the deadline is noon and kickoff is at noon.
 */
export function startScheduler(ctx: JobContext, timezone: string): ScheduledTask[] {
  const options = { timezone };

  const tasks: ScheduledTask[] = [
    // Tuesday 12:00 — grade last week, post results and standings, open the new week.
    schedule('0 12 * * 2', options, 'open-week', () => runOpenWeek(ctx)),

    // Thursday 12:00 and Sunday 11:00 — nudge anyone still incomplete.
    schedule('0 12 * * 4', options, 'nudge-thursday', () => runNudge(ctx)),
    schedule('0 11 * * 0', options, 'nudge-sunday', () => runNudge(ctx)),

    // Every night at 21:00, but only acts when games are actually due within the
    // next 24 hours — see watchLines.
    schedule('0 21 * * *', options, 'line-watch', () => watchLines(ctx)),

    // Every 15 minutes — drop options for games that just kicked off. Cheap, and
    // far simpler than scheduling a one-off timer per distinct kickoff.
    schedule('*/15 * * * *', options, 'lock-refresh', () => runLockRefresh(ctx)),

    // Hourly through game days — keep scores current for /standings and recaps.
    schedule('30 * * * 0,1,4,6', options, 'score-refresh', () => runScoreRefresh(ctx)),
  ];

  logger.info({ timezone, jobs: tasks.length }, 'scheduler started');
  return tasks;
}

function schedule(
  expression: string,
  options: { timezone: string },
  name: string,
  run: () => Promise<unknown>
): ScheduledTask {
  return cron.schedule(
    expression,
    () => {
      logger.info({ job: name }, 'job started');
      run()
        .then(() => logger.info({ job: name }, 'job finished'))
        // A throwing job must never take the process down; the next tick retries.
        .catch((error) => logger.error({ job: name, err: String(error) }, 'job failed'));
    },
    options
  );
}

/**
 * Runs the line watch on the nights it matters.
 *
 * Fires nightly, then checks the real schedule for games due in the next 24
 * hours. That is what "the night before each game day" actually means: it covers
 * a Wednesday season opener, a Friday or Saturday game, and a holiday fixture,
 * none of which a hardcoded set of weekdays would catch.
 */
async function watchLines(ctx: JobContext): Promise<void> {
  const target = ctx.repos.games.latestWeek() ?? (await currentWeek(ctx.espn));

  if (!hasGamesWithin(ctx.repos, target.season, target.week, Date.now())) {
    logger.info({ season: target.season, week: target.week }, 'no games in the next 24h; skipping line watch');
    return;
  }

  const applied = await runLineWatch(ctx.client, ctx.repos, ctx.espn, target.season, target.week);
  logger.info({ season: target.season, week: target.week, applied }, 'line watch complete');
}
