import { nickname } from '../domain/teams.js';

/**
 * Team logos are uploaded once as application-owned emojis (see
 * scripts/upload-emojis.ts), which makes them usable in every server the app
 * joins without consuming any server's own emoji slots.
 *
 * The map is loaded at startup from data/emoji-map.json. Until it exists the
 * bot still works — every renderer falls back to plain text — so a fresh
 * install posts readable messages before anyone runs the upload script.
 */

let emojiByAbbr: Record<string, string> = {};

export function loadEmojiMap(map: Record<string, string>): void {
  emojiByAbbr = { ...map };
}

export function emojiMapSize(): number {
  return Object.keys(emojiByAbbr).length;
}

/** The `<:nfl_bal:123>` mention for a team, or '' when none is uploaded. */
export function teamEmoji(abbr: string): string {
  return emojiByAbbr[abbr] ?? '';
}

/** "🐦 Ravens" — emoji then nickname, collapsing cleanly when no emoji exists. */
export function teamLabel(abbr: string): string {
  const emoji = teamEmoji(abbr);
  return emoji ? `${emoji} ${nickname(abbr)}` : nickname(abbr);
}

/** "Ravens 🐦" — for the home side, where the requirements put the icon last. */
export function teamLabelTrailing(abbr: string): string {
  const emoji = teamEmoji(abbr);
  return emoji ? `${nickname(abbr)} ${emoji}` : nickname(abbr);
}

/** The emoji name used on the application, e.g. 'nfl_bal'. */
export function emojiNameFor(abbr: string): string {
  return `nfl_${abbr.toLowerCase()}`;
}
