import { nickname } from '../domain/teams.js';
import type { Game, GameWithLine, Line } from '../domain/types.js';
import { favoriteOf, underdogOf } from '../domain/types.js';
import { teamEmoji } from './emoji.js';
import { bold, favoriteNumber, joinLines, num, underdogNumber } from './format.js';
import { renderByes } from './schedule.js';

/**
 * The weekly recap, winner first per the requirements:
 *
 *   🏈 **ARI 37** - 21 BAL 🐦 | +46.5 | ARI -7.5
 *
 * The sign on the total says which side hit (+ over, - under); the team and
 * number say who covered the spread.
 */
export function renderRecap(
  season: number,
  week: number,
  entries: readonly GameWithLine[],
  byeTeams: readonly string[]
): string {
  const header = bold(`Week ${week} — ${season} results`);
  const rows = [...entries]
    .filter(({ game }) => game.awayScore !== null && game.homeScore !== null)
    .sort((a, b) => a.game.kickoff - b.game.kickoff)
    .map(recapLine);

  const lines = [header, '', ...rows];
  if (byeTeams.length > 0) {
    lines.push('', renderByes(byeTeams));
  }

  return joinLines(lines);
}

export function recapLine({ game, line }: GameWithLine): string {
  return `${renderScore(game)} | ${renderTotalResult(game, line)} | ${renderSpreadResult(game, line)}`;
}

/** "🏈 **ARI 37** - 21 BAL 🐦" — winner leads and is bolded. */
function renderScore(game: Game): string {
  const away = game.awayScore ?? 0;
  const home = game.homeScore ?? 0;

  if (away === home) {
    // Ties are rare but legal, and neither side can lead.
    const left = `${teamEmoji(game.awayAbbr)} ${game.awayAbbr} ${away}`.trim();
    const right = `${home} ${game.homeAbbr} ${teamEmoji(game.homeAbbr)}`.trim();
    return `${left} - ${right}`;
  }

  const awayWon = away > home;
  const winner = awayWon ? game.awayAbbr : game.homeAbbr;
  const loser = awayWon ? game.homeAbbr : game.awayAbbr;
  const winnerScore = Math.max(away, home);
  const loserScore = Math.min(away, home);

  const left = `${teamEmoji(winner)} ${bold(`${winner} ${winnerScore}`)}`.trim();
  const right = `${loserScore} ${loser} ${teamEmoji(loser)}`.trim();
  return `${left} - ${right}`;
}

/** "+46.5" when the over hit, "-46.5" when the under did, "PUSH 46" on the number. */
function renderTotalResult(game: Game, line: Line): string {
  const total = (game.awayScore ?? 0) + (game.homeScore ?? 0);
  if (total === line.overUnder) return `PUSH ${num(line.overUnder)}`;
  return total > line.overUnder ? `+${num(line.overUnder)}` : `-${num(line.overUnder)}`;
}

/** The side that covered, with its number: "ARI -7.5" or "BAL +7.5". */
function renderSpreadResult(game: Game, line: Line): string {
  if (line.spread === 0) return 'PK';

  const favorite = favoriteOf(line, game);
  const underdog = underdogOf(line, game);
  if (favorite === null || underdog === null) return 'PK';

  const favScore = favorite === game.homeAbbr ? (game.homeScore ?? 0) : (game.awayScore ?? 0);
  const dogScore = underdog === game.homeAbbr ? (game.homeScore ?? 0) : (game.awayScore ?? 0);
  const margin = favScore - dogScore;
  const cushion = Math.abs(line.spread);

  if (margin === cushion) return `PUSH ${favorite} ${favoriteNumber(line.spread)}`;
  return margin > cushion
    ? `${favorite} ${favoriteNumber(line.spread)}`
    : `${underdog} ${underdogNumber(line.spread)}`;
}

/** Used by the recap header when naming a matchup in prose. */
export function matchupName(game: Game): string {
  return `${nickname(game.awayAbbr)} @ ${nickname(game.homeAbbr)}`;
}
