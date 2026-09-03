import { nickname } from '../domain/teams.js';
import type { Category, GameWithLine } from '../domain/types.js';
import { favoriteOf, underdogOf } from '../domain/types.js';
import { teamEmoji } from './emoji.js';
import { bold, favoriteNumber, joinLines, num, underdogNumber } from './format.js';

/**
 * The four pick messages.
 *
 * Discord select options cannot render markdown and carry exactly one emoji, so
 * the requirements' format ("🏈 Cardinals -7.5 @ **Bears** 🐻") is impossible
 * inside a dropdown. The compromise agreed during planning:
 *
 *   message body   full format — both emojis, home team bolded
 *   dropdown       one emoji + the home team in CAPS
 *
 * Nothing is lost: the body directly above the menu carries the real thing.
 */

export function promptFor(category: Category): string {
  switch (category) {
    case 'OVER':
    case 'UNDER':
      return `Please select a matchup that you think will hit the ${bold(category)}!`;
    case 'FAVORITE':
    case 'UNDERDOG':
      return `Please select a ${bold(category)} that will cover the spread this week!`;
  }
}

/** The message body: the prompt plus the fully formatted list of choices. */
export function renderPickMessage(category: Category, entries: readonly GameWithLine[]): string {
  const sorted = [...entries].sort((a, b) => a.game.kickoff - b.game.kickoff);
  const rows = sorted
    .map((entry) => bodyLine(category, entry))
    .filter((row): row is string => row !== null);

  if (rows.length === 0) {
    return `${promptFor(category)}\n\n_No games are still open for this pick._`;
  }

  return joinLines([promptFor(category), '', ...rows]);
}

/** One line of the message body, in the full requirement format. */
function bodyLine(category: Category, { game, line }: GameWithLine): string | null {
  if (category === 'OVER' || category === 'UNDER') {
    const away = withLeadingEmoji(game.awayAbbr);
    const home = withTrailingEmoji(game.homeAbbr, { emphasise: true });
    return `${away} @ ${home} | O/U: ${num(line.overUnder)}`;
  }

  const picked = category === 'FAVORITE' ? favoriteOf(line, game) : underdogOf(line, game);
  if (picked === null) return null; // pick'em: no favorite or underdog exists

  const opponent = picked === game.homeAbbr ? game.awayAbbr : game.homeAbbr;
  const number = category === 'FAVORITE' ? favoriteNumber(line.spread) : underdogNumber(line.spread);
  const pickedIsHome = picked === game.homeAbbr;

  // The picked team leads with its number, then "@" if it is on the road or
  // "vs" if it is at home — matching both examples in the requirements.
  const joiner = pickedIsHome ? 'vs' : '@';
  const pickedSide = `${teamEmoji(picked)} ${emphasise(nickname(picked), pickedIsHome)}`.trim();
  const opponentSide = `${emphasise(nickname(opponent), !pickedIsHome)} ${teamEmoji(opponent)}`.trim();

  return `${pickedSide} ${number} ${joiner} ${opponentSide}`;
}

/** The home team is the one bolded, wherever it appears in the line. */
function emphasise(text: string, isHome: boolean): string {
  return isHome ? bold(text) : text;
}

function withLeadingEmoji(abbr: string): string {
  const emoji = teamEmoji(abbr);
  return emoji ? `${emoji} ${nickname(abbr)}` : nickname(abbr);
}

function withTrailingEmoji(abbr: string, opts: { emphasise?: boolean } = {}): string {
  const name = opts.emphasise ? bold(nickname(abbr)) : nickname(abbr);
  const emoji = teamEmoji(abbr);
  return emoji ? `${name} ${emoji}` : name;
}

export interface PickOption {
  /** Shown in the dropdown. No markdown; Discord renders it literally. */
  readonly label: string;
  /** What the interaction handler receives back. */
  readonly value: string;
  /** Exactly one emoji is allowed per option. */
  readonly emojiAbbr: string;
  readonly description?: string;
}

/**
 * Builds the dropdown options.
 *
 * `value` encodes what the handler needs: a game id for OVER/UNDER, and
 * "gameId:TEAM" for FAVORITE/UNDERDOG so the chosen team survives a later line
 * move. Both stay well inside Discord's 100-character limit.
 */
export function buildOptions(category: Category, entries: readonly GameWithLine[]): PickOption[] {
  const sorted = [...entries].sort((a, b) => a.game.kickoff - b.game.kickoff);
  const options: PickOption[] = [];

  for (const { game, line } of sorted) {
    if (category === 'OVER' || category === 'UNDER') {
      options.push({
        label: truncate(`${nickname(game.awayAbbr)} @ ${nickname(game.homeAbbr).toUpperCase()}`),
        value: game.id,
        emojiAbbr: game.awayAbbr,
        description: `O/U ${num(line.overUnder)}`,
      });
      continue;
    }

    const picked = category === 'FAVORITE' ? favoriteOf(line, game) : underdogOf(line, game);
    if (picked === null) continue;

    const opponent = picked === game.homeAbbr ? game.awayAbbr : game.homeAbbr;
    const number = category === 'FAVORITE' ? favoriteNumber(line.spread) : underdogNumber(line.spread);
    const pickedIsHome = picked === game.homeAbbr;
    const joiner = pickedIsHome ? 'vs' : '@';

    const pickedText = pickedIsHome ? nickname(picked).toUpperCase() : nickname(picked);
    const opponentText = pickedIsHome ? nickname(opponent) : nickname(opponent).toUpperCase();

    options.push({
      label: truncate(`${pickedText} ${number} ${joiner} ${opponentText}`),
      value: `${game.id}:${picked}`,
      emojiAbbr: picked,
      description: `O/U ${num(line.overUnder)}`,
    });
  }

  // Discord allows at most 25 options; an NFL week never exceeds 16.
  return options.slice(0, 25);
}

/** Parses a select value back into its game and, for spread picks, its team. */
export function parseOptionValue(value: string): { gameId: string; teamAbbr: string | null } {
  const separator = value.indexOf(':');
  if (separator === -1) return { gameId: value, teamAbbr: null };
  return { gameId: value.slice(0, separator), teamAbbr: value.slice(separator + 1) };
}

function truncate(label: string): string {
  return label.length <= 100 ? label : `${label.slice(0, 99)}…`;
}
