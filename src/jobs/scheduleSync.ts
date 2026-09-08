import type { Client } from 'discord.js';
import type { GuildConfig, Repos } from '../db/repos.js';
import type { Game } from '../domain/types.js';
import type { EspnClient } from '../espn/client.js';
import { logger } from '../logger.js';
import { affectedBy, renderScheduleChangeAlert } from '../render/alert.js';
import { announce, refreshPickMessages } from '../services/poster.js';
import { formatKickoff, syncWeek } from '../services/week.js';

/**
 * A kickoff has to move by at least this much to be worth announcing. Real
 * schedule changes — flex scheduling, a holiday reshuffle — move games by hours;
 * anything smaller is ESPN tidying up its own timestamps.
 */
export const KICKOFF_CHANGE_THRESHOLD_MS = 30 * 60 * 1000;

export interface KickoffChange {
  readonly game: Game;
  readonly oldKickoff: number;
  readonly newKickoff: number;
  /** Positive when the game moved later. */
  readonly deltaMs: number;
}

/**
 * Re-reads the schedule from ESPN and applies any changes.
 *
 * This exists because the NFL schedule is not fixed once published. Sunday games
 * get flex-scheduled into the night slot with a couple of weeks' notice, the
 * league moves games for weather, and the Christmas and end-of-season weeks land
 * on unusual days. A kickoff time the bot snapshotted on Tuesday can be wrong by
 * Sunday.
 *
 * Getting this wrong is a correctness problem, not just a cosmetic one: picks
 * lock at kickoff, so a stale kickoff time means the bot either locks a game
 * early or — worse — keeps accepting picks on a game that has already started.
 *
 * Announcing the change matters for the same reason. A player who picked a game
 * expecting a Sunday-night deadline needs to know it now kicks off at noon.
 */
export async function runScheduleSync(
  client: Client,
  repos: Repos,
  espn: EspnClient,
  season: number,
  week: number
): Promise<KickoffChange[]> {
  // Snapshot what we believe before overwriting it.
  const before = new Map(repos.games.byWeek(season, week).map((g) => [g.id, g]));

  espn.clearCache();
  const parsed = await syncWeek(espn, repos, season, week);

  const changes: KickoffChange[] = [];
  for (const fresh of parsed.games) {
    const stored = before.get(fresh.id);
    // Only games that had not started under the old timing can meaningfully move.
    if (!stored || stored.state !== 'pre') continue;

    const deltaMs = fresh.kickoff - stored.kickoff;
    if (Math.abs(deltaMs) < KICKOFF_CHANGE_THRESHOLD_MS) continue;

    changes.push({ game: fresh, oldKickoff: stored.kickoff, newKickoff: fresh.kickoff, deltaMs });
  }

  if (changes.length === 0) return [];

  logger.info(
    { season, week, changes: changes.map((c) => ({ game: c.game.id, deltaMs: c.deltaMs })) },
    'schedule changed'
  );

  const guilds = repos.guilds.listActive();
  for (const config of guilds) {
    try {
      await announceChanges(client, repos, config, changes, season, week);
      // Deadlines shown in the pick messages changed, and a game that moved
      // earlier may already be locked.
      await refreshPickMessages(client, repos, config, season, week);
    } catch (error) {
      logger.error(
        { guildId: config.guildId, err: String(error) },
        'could not announce schedule change'
      );
    }
  }

  return changes;
}

async function announceChanges(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  changes: readonly KickoffChange[],
  season: number,
  week: number
): Promise<void> {
  for (const change of changes) {
    const picks = repos.picks.forGame(config.guildId, season, week, change.game.id);
    const message = renderScheduleChangeAlert(
      change.game,
      formatKickoff(change.oldKickoff, config.timezone),
      formatKickoff(change.newKickoff, config.timezone),
      change.deltaMs,
      affectedBy(change.game.id, picks)
    );
    await announce(client, config, message);
  }
}
