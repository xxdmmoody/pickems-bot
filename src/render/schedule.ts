import { nickname } from '../domain/teams.js';
import type { GameWithLine } from '../domain/types.js';
import { teamEmoji } from './emoji.js';
import { bold, favoriteNumber, joinLines, num } from './format.js';

/**
 * The weekly schedule message.
 *
 *   🐦 Ravens @ Dolphins 🐬 | O/U: 46.5 | BAL -7
 *   🛩️ Jets @ Patriots 🏈 | O/U: 43.5 | **NE -9.5**
 *   Byes: Lions 🦁, Bears 🐻
 *
 * The spread segment is bolded when the favorite is the home team, per the
 * requirements. Message bodies render markdown and unlimited custom emoji, so
 * this is the one place the full format from the requirements is achievable —
 * the pick dropdowns have to compromise (see picks.ts).
 */
export function renderSchedule(
  season: number,
  week: number,
  entries: readonly GameWithLine[],
  byeTeams: readonly string[]
): string {
  const header = bold(`Week ${week} — ${season} matchups`);
  const rows = [...entries]
    .sort((a, b) => a.game.kickoff - b.game.kickoff)
    .map(scheduleLine);

  const lines = [header, '', ...rows];
  if (byeTeams.length > 0) {
    lines.push('', renderByes(byeTeams));
  }

  return joinLines(lines);
}

export function scheduleLine({ game, line }: GameWithLine): string {
  const matchup = renderMatchup(game.awayAbbr, game.homeAbbr);
  const total = `O/U: ${num(line.overUnder)}`;
  return `${matchup} | ${total} | ${renderSpread(game.homeAbbr, line)}`;
}

/** "🐦 Ravens @ Dolphins 🐬" — away icon leads, home icon trails. */
export function renderMatchup(awayAbbr: string, homeAbbr: string): string {
  const away = teamEmoji(awayAbbr);
  const home = teamEmoji(homeAbbr);
  const awaySide = away ? `${away} ${nickname(awayAbbr)}` : nickname(awayAbbr);
  const homeSide = home ? `${nickname(homeAbbr)} ${home}` : nickname(homeAbbr);
  return `${awaySide} @ ${homeSide}`;
}

/** "BAL -7", bolded when the home team is the favorite. */
function renderSpread(homeAbbr: string, line: { spread: number; favoriteAbbr: string | null }): string {
  if (line.favoriteAbbr === null) return 'PK';
  const text = `${line.favoriteAbbr} ${favoriteNumber(line.spread)}`;
  return line.favoriteAbbr === homeAbbr ? bold(text) : text;
}

/** "Byes: Lions 🦁, Bears 🐻, Cardinals 🏈" */
export function renderByes(byeTeams: readonly string[]): string {
  const teams = byeTeams
    .map((abbr) => {
      const emoji = teamEmoji(abbr);
      return emoji ? `${nickname(abbr)} ${emoji}` : nickname(abbr);
    })
    .join(', ');
  return `${bold('Byes:')} ${teams}`;
}
