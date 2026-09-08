import type { LineMove } from '../domain/lineMove.js';
import type { Category, Game } from '../domain/types.js';
import { bold, favoriteNumber, joinLines, mention, num, signed } from './format.js';
import { renderMatchup } from './schedule.js';

export interface AffectedPicker {
  readonly userId: string;
  readonly category: Category;
  /** The team they picked, for FAVORITE/UNDERDOG. */
  readonly teamAbbr: string | null;
}

/**
 * The line-movement alert.
 *
 *   ⚠️ Line movement — 🐦 Ravens @ Dolphins 🐬
 *
 *   O/U: 46.5 → 41.5 (-5)
 *   Spread: BAL -7 → BAL -2.5 (4.5 point swing)
 *
 *   This game now grades at the new numbers...
 *   @USER1 (OVER) @USER4 (FAVORITE — BAL)
 *
 * Only players whose picks touch this game are mentioned, so the news is public
 * but the pings are targeted.
 */
export function renderLineMoveAlert(
  move: LineMove,
  game: Game,
  affected: readonly AffectedPicker[],
  kickoffText: string
): string {
  const lines: string[] = [
    `⚠️ ${bold('Line movement')} — ${renderMatchup(game.awayAbbr, game.homeAbbr)}`,
    '',
  ];

  if (move.reasons.includes('TOTAL')) {
    lines.push(
      `O/U: ${num(move.oldLine.overUnder)} → ${bold(num(move.newLine.overUnder))} (${signed(move.totalDelta)})`
    );
  }

  if (move.reasons.includes('SPREAD') || move.flipped) {
    const before = spreadText(move.oldLine.spread, game);
    const after = spreadText(move.newLine.spread, game);
    const swing = `${num(Math.abs(move.spreadDelta))} point swing`;
    lines.push(`Spread: ${before} → ${bold(after)} (${swing})`);
  }

  if (move.flipped) {
    lines.push('', `🔄 ${bold('The favorite and underdog have swapped sides.')}`);
  }

  if (move.newLine.spread === 0) {
    lines.push(
      '',
      `_This game is now a pick'em with no favorite or underdog. Any FAVORITE or UNDERDOG pick on it will push._`
    );
  }

  lines.push('', `This game now grades at the new numbers. You can change your pick until ${kickoffText}.`);

  if (affected.length > 0) {
    lines.push('', affected.map(describePicker).join(' '));
  }

  return joinLines(lines);
}

function describePicker({ userId, category, teamAbbr }: AffectedPicker): string {
  const detail = teamAbbr ? `${category} — ${teamAbbr}` : category;
  return `${mention(userId)} (${detail})`;
}

/** "BAL -7" from a home-relative spread, or "PK" at zero. */
function spreadText(spread: number, game: Game): string {
  if (spread === 0) return 'PK';
  const favorite = spread < 0 ? game.homeAbbr : game.awayAbbr;
  return `${favorite} ${favoriteNumber(spread)}`;
}

/**
 * The schedule-change alert, posted when a kickoff moves.
 *
 *   📅 **Schedule change** — 🐦 Ravens @ Dolphins 🐬
 *
 *   Kickoff moved from Sun 12:00 PM CDT to **Sun 7:20 PM CDT** — 7h 20m later.
 *   Your pick on this game now locks at the new time.
 *   @USER1 (OVER)
 */
export function renderScheduleChangeAlert(
  game: Game,
  oldKickoff: string,
  newKickoff: string,
  deltaMs: number,
  affected: readonly AffectedPicker[]
): string {
  const direction = deltaMs > 0 ? 'later' : 'earlier';
  const lines: string[] = [
    `📅 ${bold('Schedule change')} — ${renderMatchup(game.awayAbbr, game.homeAbbr)}`,
    '',
    `Kickoff moved from ${oldKickoff} to ${bold(newKickoff)} — ${humanizeDuration(Math.abs(deltaMs))} ${direction}.`,
    '',
    deltaMs > 0
      ? 'You now have longer to pick this game.'
      : `⏰ ${bold('This game locks sooner than it used to.')}`,
  ];

  if (affected.length > 0) {
    lines.push('', affected.map(describePicker).join(' '));
  }

  return joinLines(lines);
}

/** "7h 20m", "45m", "2d 3h" — compact enough for one line of an alert. */
function humanizeDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 && days === 0) parts.push(`${mins}m`);
  return parts.join(' ') || '0m';
}

/** Who a move affects: anyone whose pick is on this game. */
export function affectedBy(
  gameId: string,
  picks: readonly { userId: string; category: Category; gameId: string; teamAbbr: string | null }[]
): AffectedPicker[] {
  return picks
    .filter((p) => p.gameId === gameId)
    .map(({ userId, category, teamAbbr }) => ({ userId, category, teamAbbr }));
}
