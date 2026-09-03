import type { Repos } from '../db/repos.js';
import { checkLock } from '../domain/lock.js';
import { findOverlap } from '../domain/overlap.js';
import { nickname } from '../domain/teams.js';
import { CATEGORIES, type Category, type Pick } from '../domain/types.js';
import { formatKickoff } from './week.js';

export type SubmitResult =
  | { ok: true; pick: Pick; complete: boolean; slate: Pick[] }
  | { ok: false; reason: string };

export interface SubmitRequest {
  guildId: string;
  userId: string;
  season: number;
  week: number;
  category: Category;
  gameId: string;
  teamAbbr: string | null;
  timezone: string;
}

/**
 * Validates and stores one pick.
 *
 * Order matters: lock rules run before overlap, so a player who is too late
 * hears about the kickoff rather than being told to reshuffle picks they can no
 * longer change.
 */
export function submitPick(repos: Repos, request: SubmitRequest, now = Date.now()): SubmitResult {
  const { guildId, userId, season, week, category, gameId, teamAbbr, timezone } = request;

  const targetGame = repos.games.get(gameId);
  if (!targetGame) {
    return { ok: false, reason: 'That game is no longer available. Try the latest picks message.' };
  }

  const existing = repos.picks.forUserWeek(guildId, userId, season, week);
  const currentPick = existing.find((p) => p.category === category) ?? null;
  const currentGame = currentPick ? repos.games.get(currentPick.gameId) : null;

  const lockError = checkLock(category, targetGame, currentPick, currentGame, now);
  if (lockError) {
    return { ok: false, reason: describeLock(lockError, repos, timezone) };
  }

  const overlap = findOverlap(category, gameId, existing);
  if (overlap) {
    const conflictGame = repos.games.get(overlap.gameId);
    const matchup = conflictGame
      ? `${nickname(conflictGame.awayAbbr)} @ ${nickname(conflictGame.homeAbbr)}`
      : 'that game';
    return {
      ok: false,
      reason:
        `You already used **${matchup}** for your **${overlap.conflictingCategory}** pick. ` +
        `All four picks must be on different games — pick another game, or change your ` +
        `${overlap.conflictingCategory} first.`,
    };
  }

  const pick: Pick = { guildId, userId, season, week, category, gameId, teamAbbr };
  repos.picks.upsert(pick);

  const slate = repos.picks.forUserWeek(guildId, userId, season, week);
  return { ok: true, pick, complete: slate.length === CATEGORIES.length, slate };
}

function describeLock(
  error: ReturnType<typeof checkLock> & object,
  repos: Repos,
  timezone: string
): string {
  const game = repos.games.get(error.gameId);
  const matchup = game ? `${nickname(game.awayAbbr)} @ ${nickname(game.homeAbbr)}` : 'that game';

  if (error.kind === 'GAME_STARTED') {
    return `**${matchup}** has already started, so it can no longer be picked.`;
  }

  const kickoff = game ? formatKickoff(game.kickoff, timezone) : 'kickoff';
  return (
    `Your **${error.category}** pick is on **${matchup}**, which started at ${kickoff}. ` +
    `Picks lock once their game begins, so this one can no longer be changed.`
  );
}

/** The categories a player still owes — drives the Thursday and Sunday nudges. */
export function missingCategories(picks: readonly Pick[]): Category[] {
  const made = new Set(picks.map((p) => p.category));
  return CATEGORIES.filter((c) => !made.has(c));
}

export interface MissingSlate {
  userId: string;
  categories: Category[];
}

/** Participants who still owe at least one pick, in role order. */
export function findIncomplete(
  repos: Repos,
  guildId: string,
  season: number,
  week: number,
  participantIds: readonly string[]
): MissingSlate[] {
  const byUser = new Map<string, Pick[]>();
  for (const pick of repos.picks.forWeek(guildId, season, week)) {
    const list = byUser.get(pick.userId) ?? [];
    list.push(pick);
    byUser.set(pick.userId, list);
  }

  const incomplete: MissingSlate[] = [];
  for (const userId of participantIds) {
    const categories = missingCategories(byUser.get(userId) ?? []);
    if (categories.length > 0) incomplete.push({ userId, categories });
  }
  return incomplete;
}

/** A readable summary of a saved slate, for the ephemeral confirmation. */
export function describeSlate(repos: Repos, slate: readonly Pick[]): string[] {
  const ordered = CATEGORIES.map((c) => slate.find((p) => p.category === c)).filter(
    (p): p is Pick => p !== undefined
  );

  return ordered.map((pick) => {
    const game = repos.games.get(pick.gameId);
    if (!game) return `**${pick.category}**: (unknown game)`;
    const matchup = `${nickname(game.awayAbbr)} @ ${nickname(game.homeAbbr)}`;
    return pick.teamAbbr
      ? `**${pick.category}**: ${nickname(pick.teamAbbr)} (${matchup})`
      : `**${pick.category}**: ${matchup}`;
  });
}
