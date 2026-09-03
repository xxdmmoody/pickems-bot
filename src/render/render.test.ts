import { beforeEach, describe, expect, it } from 'vitest';
import type { LineMove } from '../domain/lineMove.js';
import { detectMove } from '../domain/lineMove.js';
import type { Game, GameWithLine, Line } from '../domain/types.js';
import { renderLineMoveAlert } from './alert.js';
import { loadEmojiMap } from './emoji.js';
import { buildOptions, parseOptionValue, renderPickMessage } from './picks.js';
import { recapLine } from './recap.js';
import { renderNudge, renderResults, renderStandings } from './results.js';
import { renderByes, scheduleLine } from './schedule.js';

const KICKOFF = Date.parse('2026-09-13T17:00:00Z');

function game(
  id: string,
  awayAbbr: string,
  homeAbbr: string,
  awayScore: number | null = null,
  homeScore: number | null = null
): Game {
  return {
    id,
    season: 2026,
    week: 1,
    awayAbbr,
    homeAbbr,
    kickoff: KICKOFF,
    state: awayScore === null ? 'pre' : 'post',
    awayScore,
    homeScore,
  };
}

function line(gameId: string, spread: number, overUnder: number, g: Game): Line {
  return {
    gameId,
    season: 2026,
    week: 1,
    overUnder,
    spread,
    favoriteAbbr: spread === 0 ? null : spread < 0 ? g.homeAbbr : g.awayAbbr,
    underdogAbbr: spread === 0 ? null : spread < 0 ? g.awayAbbr : g.homeAbbr,
  };
}

function entry(g: Game, spread: number, overUnder: number): GameWithLine {
  return { game: g, line: line(g.id, spread, overUnder, g) };
}

// Renderers are tested without emojis by default so the assertions read as the
// plain-text skeleton of each format; the emoji test loads a map explicitly.
beforeEach(() => loadEmojiMap({}));

describe('schedule line', () => {
  it('leaves an away favorite unbolded', () => {
    // Requirement: "X Ravens @ Dolphins X | O/U: 46.5 | BAL -7"
    const g = game('1', 'BAL', 'MIA');
    expect(scheduleLine(entry(g, 7, 46.5))).toBe('Ravens @ Dolphins | O/U: 46.5 | BAL -7');
  });

  it('bolds the spread when the home team is favored', () => {
    // Requirement: "X Jets @ Patriots X | O/U: 43.5 | **NE -9.5**"
    const g = game('2', 'NYJ', 'NE');
    expect(scheduleLine(entry(g, -9.5, 43.5))).toBe('Jets @ Patriots | O/U: 43.5 | **NE -9.5**');
  });

  it('renders a pick-em without inventing a favorite', () => {
    const g = game('3', 'NYJ', 'NE');
    expect(scheduleLine(entry(g, 0, 43.5))).toBe('Jets @ Patriots | O/U: 43.5 | PK');
  });

  it('includes team emoji on both sides when a map is loaded', () => {
    loadEmojiMap({ BAL: '<:nfl_bal:1>', MIA: '<:nfl_mia:2>' });
    const g = game('1', 'BAL', 'MIA');
    expect(scheduleLine(entry(g, 7, 46.5))).toBe(
      '<:nfl_bal:1> Ravens @ Dolphins <:nfl_mia:2> | O/U: 46.5 | BAL -7'
    );
  });

  it('lists byes with their nickname', () => {
    expect(renderByes(['DET', 'CHI'])).toBe('**Byes:** Lions, Bears');
  });
});

describe('pick message body', () => {
  it('bolds the home team for over/under', () => {
    const g = game('1', 'BAL', 'MIA');
    const body = renderPickMessage('OVER', [entry(g, 7, 46.5)]);
    expect(body).toContain('Please select a matchup that you think will hit the **OVER**!');
    expect(body).toContain('Ravens @ **Dolphins** | O/U: 46.5');
  });

  it('leads with the favorite and its number, using @ when it is on the road', () => {
    // Requirement: "X Cardinals -7.5 @ **Bears** X"
    const g = game('1', 'ARI', 'CHI');
    const body = renderPickMessage('FAVORITE', [entry(g, 7.5, 46.5)]);
    expect(body).toContain('Please select a **FAVORITE** that will cover the spread this week!');
    expect(body).toContain('Cardinals -7.5 @ **Bears**');
  });

  it('uses vs when the picked underdog is at home', () => {
    // Requirement: "X **Bears** +7.5 vs Cardinals X"
    const g = game('1', 'ARI', 'CHI');
    expect(renderPickMessage('UNDERDOG', [entry(g, 7.5, 46.5)])).toContain('**Bears** +7.5 vs Cardinals');
  });

  it('omits pick-em games from favorite and underdog messages', () => {
    const g = game('1', 'ARI', 'CHI');
    expect(renderPickMessage('FAVORITE', [entry(g, 0, 46.5)])).toContain('No games are still open');
  });
});

describe('pick dropdown options', () => {
  it('caps the home team, since select labels cannot render bold', () => {
    const g = game('1', 'BAL', 'MIA');
    const [option] = buildOptions('OVER', [entry(g, 7, 46.5)]);
    expect(option?.label).toBe('Ravens @ DOLPHINS');
    expect(option?.emojiAbbr).toBe('BAL');
    expect(option?.value).toBe('1');
  });

  it('never emits markdown in a label', () => {
    const g = game('1', 'ARI', 'CHI');
    const options = [
      ...buildOptions('FAVORITE', [entry(g, 7.5, 46.5)]),
      ...buildOptions('UNDER', [entry(g, 7.5, 46.5)]),
    ];
    expect(options.every((o) => !o.label.includes('*'))).toBe(true);
  });

  it('encodes the chosen team so it survives a later line move', () => {
    const g = game('1', 'ARI', 'CHI');
    const [option] = buildOptions('FAVORITE', [entry(g, 7.5, 46.5)]);
    expect(option?.label).toBe('Cardinals -7.5 @ BEARS');
    expect(option?.value).toBe('1:ARI');
    expect(parseOptionValue(option!.value)).toEqual({ gameId: '1', teamAbbr: 'ARI' });
  });

  it('parses an over/under value as a bare game id', () => {
    expect(parseOptionValue('401772936')).toEqual({ gameId: '401772936', teamAbbr: null });
  });

  it('stays within Discord limits', () => {
    const entries = Array.from({ length: 16 }, (_, i) => entry(game(String(i), 'ARI', 'CHI'), 7.5, 46.5));
    const options = buildOptions('OVER', entries);
    expect(options.length).toBeLessThanOrEqual(25);
    expect(options.every((o) => o.label.length <= 100)).toBe(true);
    expect(options.every((o) => o.value.length <= 100)).toBe(true);
  });
});

describe('recap line', () => {
  it('matches the requirement example', () => {
    // ARI 37 BAL 21, O/U 46.5, ARI favored by 7.5.
    const g = game('1', 'ARI', 'BAL', 37, 21);
    expect(recapLine(entry(g, 7.5, 46.5))).toBe('**ARI 37** - 21 BAL | +46.5 | ARI -7.5');
  });

  it('marks the under with a minus sign', () => {
    const g = game('1', 'ARI', 'BAL', 10, 13);
    expect(recapLine(entry(g, 7.5, 46.5))).toContain('| -46.5 |');
  });

  it('names the underdog when the dog covers', () => {
    // BAL favored by 7.5 at home but wins by only 3.
    const g = game('1', 'ARI', 'BAL', 21, 24);
    expect(recapLine(entry(g, -7.5, 46.5))).toBe('**BAL 24** - 21 ARI | -46.5 | ARI +7.5');
  });

  it('marks a spread push', () => {
    const g = game('1', 'ARI', 'BAL', 21, 24);
    expect(recapLine(entry(g, -3, 46.5))).toContain('PUSH BAL -3');
  });

  it('marks a total push', () => {
    const g = game('1', 'ARI', 'BAL', 24, 22);
    expect(recapLine(entry(g, -3, 46))).toContain('| PUSH 46 |');
  });

  it('handles a tie without claiming a winner', () => {
    const g = game('1', 'ARI', 'BAL', 20, 20);
    expect(recapLine(entry(g, -3, 46.5))).toContain('ARI 20 - 20 BAL');
  });
});

describe('weekly results', () => {
  const r = (userId: string, wins: number, losses: number, pushes = 0) => ({
    userId,
    wins,
    losses,
    pushes,
  });

  it('groups by record and omits empty tiers', () => {
    const text = renderResults(3, [r('u1', 4, 0), r('u2', 4, 0), r('u3', 3, 1), r('u4', 2, 2)]);
    expect(text).toContain('**4-0**: <@u1>, <@u2>');
    expect(text).toContain('**3-1**: <@u3>');
    expect(text).toContain('**2-2**: <@u4>');
    expect(text).not.toContain('0-4');
  });

  it('notes pushes on a shortened record', () => {
    expect(renderResults(3, [r('u1', 3, 0, 1)])).toContain('**3-0** _(1 push)_: <@u1>');
  });
});

describe('standings', () => {
  it('medals the top three and lists everyone else', () => {
    const text = renderStandings(2026, [
      { userId: 'u1', wins: 15, losses: 4, pushes: 0 },
      { userId: 'u2', wins: 13, losses: 6, pushes: 0 },
      { userId: 'u3', wins: 10, losses: 9, pushes: 0 },
      { userId: 'u4', wins: 5, losses: 14, pushes: 0 },
    ]);
    expect(text).toContain('🥇 <@u1> - 15-4');
    expect(text).toContain('🥈 <@u2> - 13-6');
    expect(text).toContain('🥉 <@u3> - 10-9');
    expect(text).toContain('<@u4> - 5-14');
  });

  it('shows more than six players, per the agreed change', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      userId: `u${i}`,
      wins: 20 - i,
      losses: i,
      pushes: 0,
    }));
    const text = renderStandings(2026, many);
    expect(many.every((m) => text.includes(`<@${m.userId}>`))).toBe(true);
  });
});

describe('nudge', () => {
  it('names each player and the picks they owe', () => {
    const text = renderNudge(3, [{ userId: 'u1', categories: ['OVER', 'UNDERDOG'] }]);
    expect(text).toContain('<@u1> — still needs: OVER, UNDERDOG');
  });

  it('says so when everyone is done', () => {
    expect(renderNudge(3, [])).toContain('Everyone is locked in');
  });
});

describe('line movement alert', () => {
  const g = game('1', 'BAL', 'MIA');

  function move(oldSpread: number, newSpread: number, oldOu: number, newOu: number): LineMove {
    const detected = detectMove(line('1', oldSpread, oldOu, g), line('1', newSpread, newOu, g));
    if (!detected) throw new Error('expected a significant move');
    return detected;
  }

  it('reports a total swing with its direction', () => {
    const text = renderLineMoveAlert(move(7, 7, 46.5, 41.5), g, [], 'Sun 12:00 PM CT');
    expect(text).toContain('O/U: 46.5 → **41.5** (-5)');
  });

  it('reports a spread swing naming the favorite on each side', () => {
    const text = renderLineMoveAlert(move(7, 2.5, 46.5, 46.5), g, [], 'Sun 12:00 PM CT');
    expect(text).toContain('Spread: BAL -7 → **BAL -2.5** (4.5 point swing)');
  });

  it('calls out a favorite flip', () => {
    const text = renderLineMoveAlert(move(1.5, -1, 46.5, 46.5), g, [], 'Sun 12:00 PM CT');
    expect(text).toContain('swapped sides');
    expect(text).toContain('Spread: BAL -1.5 → **MIA -1**');
  });

  it('warns when a game becomes a pick-em', () => {
    const text = renderLineMoveAlert(move(4, 0, 46.5, 46.5), g, [], 'Sun 12:00 PM CT');
    expect(text).toContain("pick'em");
  });

  it('mentions only the affected pickers, with what they picked', () => {
    const text = renderLineMoveAlert(move(7, 2.5, 46.5, 46.5), g, [
      { userId: 'u1', category: 'OVER', teamAbbr: null },
      { userId: 'u4', category: 'FAVORITE', teamAbbr: 'BAL' },
    ], 'Sun 12:00 PM CT');
    expect(text).toContain('<@u1> (OVER)');
    expect(text).toContain('<@u4> (FAVORITE — BAL)');
  });
});
