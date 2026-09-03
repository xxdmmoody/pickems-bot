import { z } from 'zod';
import { TEAMS } from '../domain/teams.js';
import type { Game, GameState, Line } from '../domain/types.js';

/**
 * Schemas describe only the fields the bot actually consumes. ESPN's payload is
 * large and undocumented; validating a narrow slice means an unrelated shape
 * change upstream doesn't take the bot down, while a change to something we do
 * rely on fails loudly at the boundary instead of silently producing nonsense.
 */

const teamSchema = z.object({
  abbreviation: z.string(),
});

const competitorSchema = z.object({
  homeAway: z.enum(['home', 'away']),
  // ESPN sends scores as strings, and sends "0" for games that have not been
  // played. The state field, not this value, decides whether a score is real.
  score: z.union([z.string(), z.number()]).optional(),
  team: teamSchema,
});

const teamOddsSchema = z
  .object({
    favorite: z.boolean().optional(),
    underdog: z.boolean().optional(),
    team: teamSchema.optional(),
  })
  .optional();

const oddsSchema = z.object({
  provider: z.object({ id: z.string(), name: z.string(), priority: z.number().optional() }).optional(),
  overUnder: z.number().optional(),
  /** Home-relative and signed: negative means the home team is favored. */
  spread: z.number().optional(),
  details: z.string().optional(),
  homeTeamOdds: teamOddsSchema,
  awayTeamOdds: teamOddsSchema,
});

const competitionSchema = z.object({
  competitors: z.array(competitorSchema),
  odds: z.array(oddsSchema).optional(),
});

const eventSchema = z.object({
  id: z.string(),
  date: z.string(),
  status: z.object({
    type: z.object({ state: z.enum(['pre', 'in', 'post']) }),
  }),
  competitions: z.array(competitionSchema).min(1),
});

export const scoreboardSchema = z.object({
  season: z.object({ year: z.number(), type: z.number() }),
  week: z.object({ number: z.number() }),
  events: z.array(eventSchema),
});

export type Scoreboard = z.infer<typeof scoreboardSchema>;

const teamsSchema = z.object({
  sports: z
    .array(
      z.object({
        leagues: z
          .array(
            z.object({
              teams: z.array(
                z.object({
                  team: z.object({
                    id: z.string(),
                    abbreviation: z.string(),
                    location: z.string(),
                    name: z.string(),
                    displayName: z.string(),
                    logos: z.array(z.object({ href: z.string() })).optional(),
                  }),
                })
              ),
            })
          )
          .min(1),
      })
    )
    .min(1),
});

export interface ParsedWeek {
  readonly season: number;
  readonly week: number;
  readonly games: Game[];
  /** Only games ESPN published a usable line for. */
  readonly lines: Line[];
  /** Teams with no game this week, derived as all 32 minus those playing. */
  readonly byeTeams: string[];
}

export function parseScoreboard(payload: unknown): ParsedWeek {
  const data = scoreboardSchema.parse(payload);
  const season = data.season.year;
  const week = data.week.number;

  const games: Game[] = [];
  const lines: Line[] = [];
  const playing = new Set<string>();

  for (const event of data.events) {
    const competition = event.competitions[0];
    if (!competition) continue;

    const home = competition.competitors.find((c) => c.homeAway === 'home');
    const away = competition.competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;

    const state = event.status.type.state as GameState;
    const scored = state !== 'pre';

    const game: Game = {
      id: event.id,
      season,
      week,
      awayAbbr: away.team.abbreviation,
      homeAbbr: home.team.abbreviation,
      kickoff: Date.parse(event.date),
      state,
      awayScore: scored ? toScore(away.score) : null,
      homeScore: scored ? toScore(home.score) : null,
    };
    games.push(game);

    playing.add(game.awayAbbr);
    playing.add(game.homeAbbr);

    const line = toLine(game, competition.odds);
    if (line) lines.push(line);
  }

  const byeTeams = TEAMS.map((t) => t.abbr).filter((abbr) => !playing.has(abbr));

  return { season, week, games, lines, byeTeams };
}

/**
 * Picks the line to use for a game.
 *
 * ESPN has consistently returned a single DraftKings entry, but the field is an
 * array, so prefer the lowest `priority` and require both numbers to be present
 * — a partial entry is worse than none, because a missing spread must never be
 * read as a pick'em.
 */
function toLine(game: Game, odds: z.infer<typeof oddsSchema>[] | undefined): Line | null {
  if (!odds || odds.length === 0) return null;

  const usable = odds
    .filter((o) => typeof o.spread === 'number' && typeof o.overUnder === 'number')
    .sort((a, b) => (a.provider?.priority ?? 99) - (b.provider?.priority ?? 99));

  const best = usable[0];
  if (!best || best.spread === undefined || best.overUnder === undefined) return null;

  const spread = best.spread;
  const favoriteAbbr = spread === 0 ? null : spread < 0 ? game.homeAbbr : game.awayAbbr;
  const underdogAbbr = spread === 0 ? null : spread < 0 ? game.awayAbbr : game.homeAbbr;

  return {
    gameId: game.id,
    season: game.season,
    week: game.week,
    overUnder: best.overUnder,
    spread,
    favoriteAbbr,
    underdogAbbr,
  };
}

function toScore(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedTeam {
  readonly abbr: string;
  readonly espnId: string;
  readonly displayName: string;
  readonly logo: string;
}

export function parseTeams(payload: unknown): ParsedTeam[] {
  const data = teamsSchema.parse(payload);
  const league = data.sports[0]?.leagues[0];
  if (!league) return [];

  return league.teams.map(({ team }) => ({
    abbr: team.abbreviation,
    espnId: team.id,
    displayName: team.displayName,
    logo: team.logos?.[0]?.href ?? '',
  }));
}
