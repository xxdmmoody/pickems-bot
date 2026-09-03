import { describe, expect, it } from 'vitest';
import finalWeek from './fixtures/scoreboard-final.json' with { type: 'json' };
import upcomingWeek from './fixtures/scoreboard-upcoming.json' with { type: 'json' };
import teamsFixture from './fixtures/teams.json' with { type: 'json' };
import { parseScoreboard, parseTeams } from './mapper.js';

describe('parseScoreboard on an upcoming week', () => {
  const parsed = parseScoreboard(upcomingWeek);

  it('reads the season and week', () => {
    expect(parsed.season).toBe(2026);
    expect(parsed.week).toBe(1);
  });

  it('maps every event to a game', () => {
    expect(parsed.games).toHaveLength(16);
  });

  it('finds a line for every game', () => {
    expect(parsed.lines).toHaveLength(16);
  });

  it('leaves pre-game scores null rather than reading ESPN\'s placeholder "0"', () => {
    // Every game is scheduled, so a 0 here would silently grade unplayed games.
    expect(parsed.games.every((g) => g.state === 'pre')).toBe(true);
    expect(parsed.games.every((g) => g.awayScore === null && g.homeScore === null)).toBe(true);
  });

  it('parses kickoff times as epoch milliseconds', () => {
    const first = parsed.games[0];
    expect(Number.isFinite(first?.kickoff)).toBe(true);
    expect(new Date(first!.kickoff).toISOString()).toBe('2026-09-10T00:20:00.000Z');
  });

  it('derives the favorite from the sign of the home-relative spread', () => {
    const seattle = parsed.games.find((g) => g.homeAbbr === 'SEA');
    const line = parsed.lines.find((l) => l.gameId === seattle?.id);
    // Fixture: NE @ SEA, "SEA -3.5", spread -3.5 => home favored.
    expect(line?.spread).toBe(-3.5);
    expect(line?.favoriteAbbr).toBe('SEA');
    expect(line?.underdogAbbr).toBe('NE');
  });

  it('handles an away favorite, where the spread is positive', () => {
    const indy = parsed.games.find((g) => g.homeAbbr === 'IND');
    const line = parsed.lines.find((l) => l.gameId === indy?.id);
    // Fixture: BAL @ IND, "BAL -3.5", spread +3.5 => away favored.
    expect(line?.spread).toBe(3.5);
    expect(line?.favoriteAbbr).toBe('BAL');
    expect(line?.underdogAbbr).toBe('IND');
  });

  it('derives byes as the teams not playing', () => {
    // 16 games covers all 32 teams, so week 1 has no byes.
    expect(parsed.byeTeams).toEqual([]);
  });
});

describe('parseScoreboard on a completed week', () => {
  const parsed = parseScoreboard(finalWeek);

  it('reads final scores', () => {
    const game = parsed.games.find((g) => g.awayAbbr === 'MIA' && g.homeAbbr === 'BUF');
    expect(game?.state).toBe('post');
    expect(game?.awayScore).toBe(21);
    expect(game?.homeScore).toBe(31);
  });

  it('returns no lines, because ESPN drops odds once a game finals', () => {
    // This is exactly why lines are snapshotted at pick time and never refetched
    // for grading.
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.games.length).toBeGreaterThan(0);
  });
});

describe('parseTeams', () => {
  it('returns all 32 teams with logos', () => {
    const teams = parseTeams(teamsFixture);
    expect(teams).toHaveLength(32);
    expect(teams.every((t) => t.logo.startsWith('https://'))).toBe(true);
  });
});

describe('validation', () => {
  it('rejects a payload missing the fields the bot depends on', () => {
    expect(() => parseScoreboard({ season: { year: 2026 } })).toThrow();
  });

  it('ignores an odds entry that is missing half the line', () => {
    const payload = {
      season: { year: 2026, type: 2 },
      week: { number: 1 },
      events: [
        {
          id: '1',
          date: '2026-09-10T00:20Z',
          status: { type: { state: 'pre' } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', score: '0', team: { abbreviation: 'SEA' } },
                { homeAway: 'away', score: '0', team: { abbreviation: 'NE' } },
              ],
              // A spread with no total must not be treated as usable, and a
              // missing spread must never be read as a pick'em.
              odds: [{ spread: -3.5 }],
            },
          ],
        },
      ],
    };
    const parsed = parseScoreboard(payload);
    expect(parsed.games).toHaveLength(1);
    expect(parsed.lines).toHaveLength(0);
  });
});
