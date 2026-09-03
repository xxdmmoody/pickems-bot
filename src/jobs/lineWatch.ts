import type { Client } from 'discord.js';
import type { GuildConfig, Repos } from '../db/repos.js';
import { detectMove, type LineMove } from '../domain/lineMove.js';
import type { Game, Line } from '../domain/types.js';
import type { EspnClient } from '../espn/client.js';
import { parseScoreboard } from '../espn/mapper.js';
import { logger } from '../logger.js';
import { affectedBy, renderLineMoveAlert } from '../render/alert.js';
import { announce, refreshPickMessages } from '../services/poster.js';
import { formatKickoff } from '../services/week.js';

/**
 * Scans for significant line movement and, where it finds any, updates the line
 * and tells the players it affects.
 *
 * Runs the night before each game day. A move counts as significant when the
 * spread swings 3+, the total swings 3+, or the favorite and underdog flip.
 *
 * Guards, in order of how badly each would hurt if missed:
 *  - Only games still in `pre` are considered. A line is never rewritten after
 *    kickoff, which also sidesteps ESPN dropping odds once a game finals.
 *  - A game ESPN returns no line for keeps its stored line. A missing payload
 *    must never be read as a move to zero.
 *  - Recording a move is unique on (game, new numbers), so a re-run or a restart
 *    mid-scan cannot announce the same move twice.
 */
export async function runLineWatch(
  client: Client,
  repos: Repos,
  espn: EspnClient,
  season: number,
  week: number,
  now = Date.now()
): Promise<number> {
  espn.clearCache();

  const parsed = parseScoreboard(await espn.scoreboard(season, week));
  const fresh = new Map<string, Line>(parsed.lines.map((l) => [l.gameId, l]));

  const guilds = repos.guilds.listActive();
  let applied = 0;

  for (const game of repos.games.byWeek(season, week)) {
    if (game.state !== 'pre' || now >= game.kickoff) continue;

    const stored = repos.lines.get(game.id);
    if (!stored) continue;

    const current = fresh.get(game.id);
    if (!current) {
      logger.warn(
        { gameId: game.id, season, week },
        'ESPN returned no line for a scheduled game; keeping the stored line'
      );
      continue;
    }

    const move = detectMove(stored, current);
    if (!move) continue;

    // Record first: if this returns false the move was already handled, and
    // re-announcing it would be noise.
    if (!repos.lineMoves.record(move)) {
      logger.debug({ gameId: game.id }, 'line move already recorded, skipping alert');
      continue;
    }

    repos.lines.applyMove(current);
    applied += 1;

    logger.info(
      {
        gameId: game.id,
        reasons: move.reasons,
        spread: `${move.oldLine.spread} -> ${move.newLine.spread}`,
        total: `${move.oldLine.overUnder} -> ${move.newLine.overUnder}`,
      },
      'applied significant line move'
    );

    for (const config of guilds) {
      await alertGuild(client, repos, config, game, move, season, week);
    }
  }

  if (applied > 0) {
    // The dropdown labels carry the numbers, so they have to be rebuilt.
    for (const config of guilds) {
      await refreshPickMessages(client, repos, config, season, week, now);
    }
  }

  return applied;
}

async function alertGuild(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  game: Game,
  move: LineMove,
  season: number,
  week: number
): Promise<void> {
  const picks = repos.picks.forGame(config.guildId, season, week, game.id);
  const affected = affectedBy(game.id, picks);

  const alert = renderLineMoveAlert(move, game, affected, formatKickoff(game.kickoff, config.timezone));

  try {
    await announce(client, config, alert);
  } catch (error) {
    logger.error({ guildId: config.guildId, err: String(error) }, 'could not post line move alert');
  }
}
