import { ChannelType, type Client } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db/index.js';
import { createRepos, type Repos } from '../db/repos.js';
import type { Game } from '../domain/types.js';
import { EspnClient } from '../espn/client.js';
import { loadEmojiMap } from '../render/emoji.js';
import { runLineWatch } from './lineWatch.js';

const GUILD = 'guild-1';
const KICKOFF = Date.parse('2026-09-13T17:00:00Z');
const NOW = KICKOFF - 86_400_000; // the night before

let db: Database;
let repos: Repos;
let sent: string[];
let edits: number;
let client: Client;

/** Builds a scoreboard payload with one game at the given line. */
function scoreboard(spread: number, overUnder: number, state: 'pre' | 'post' = 'pre', scores?: [number, number]) {
  return {
    season: { year: 2026, type: 2 },
    week: { number: 1 },
    events: [
      {
        id: 'g1',
        date: new Date(KICKOFF).toISOString(),
        status: { type: { state } },
        competitions: [
          {
            competitors: [
              { homeAway: 'home', score: String(scores?.[1] ?? 0), team: { abbreviation: 'MIA' } },
              { homeAway: 'away', score: String(scores?.[0] ?? 0), team: { abbreviation: 'BAL' } },
            ],
            odds: state === 'post' ? undefined : [{ spread, overUnder, provider: { id: '100', name: 'DK', priority: 1 } }],
          },
        ],
      },
    ],
  };
}

function espnReturning(payload: unknown): EspnClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return new EspnClient({ fetchImpl, cacheTtlMs: 0 });
}

function game(): Game {
  return {
    id: 'g1',
    season: 2026,
    week: 1,
    awayAbbr: 'BAL',
    homeAbbr: 'MIA',
    kickoff: KICKOFF,
    state: 'pre',
    awayScore: null,
    homeScore: null,
  };
}

beforeEach(() => {
  loadEmojiMap({});
  db = openDatabase(':memory:');
  repos = createRepos(db);
  sent = [];
  edits = 0;

  repos.guilds.upsert({
    guildId: GUILD,
    channelId: 'c1',
    roleId: 'r1',
    timezone: 'America/Chicago',
  });
  repos.games.upsertMany([game()]);
  repos.lines.snapshotMany([
    {
      gameId: 'g1',
      season: 2026,
      week: 1,
      overUnder: 46.5,
      spread: -7,
      favoriteAbbr: 'MIA',
      underdogAbbr: 'BAL',
    },
  ]);

  const channel = {
    id: 'c1',
    type: ChannelType.GuildText,
    send: async ({ content }: { content: string }) => {
      sent.push(content);
      return { id: `m${sent.length}` };
    },
    messages: {
      fetch: async () => ({
        content: '',
        edit: async () => {
          edits += 1;
        },
      }),
    },
  };

  client = { channels: { fetch: async () => channel } } as unknown as Client;
});

describe('runLineWatch', () => {
  it('does nothing when the line has not moved significantly', async () => {
    const applied = await runLineWatch(client, repos, espnReturning(scoreboard(-5, 46.5)), 2026, 1, NOW);

    expect(applied).toBe(0);
    expect(sent).toEqual([]);
    expect(repos.lines.get('g1')?.spread).toBe(-7);
  });

  it('applies a significant move and alerts', async () => {
    const applied = await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 41.5)), 2026, 1, NOW);

    expect(applied).toBe(1);
    expect(repos.lines.get('g1')).toMatchObject({ spread: -2.5, overUnder: 41.5 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Line movement');
    expect(sent[0]).toContain('O/U: 46.5 → **41.5**');
  });

  it('rebuilds the pick dropdowns so the shown numbers match what will grade', async () => {
    // Four pick messages exist for the week.
    for (const kind of ['PICK_OVER', 'PICK_UNDER', 'PICK_FAVORITE', 'PICK_UNDERDOG'] as const) {
      repos.messages.save({ guildId: GUILD, season: 2026, week: 1, kind, channelId: 'c1', messageId: 'm1' });
    }

    await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 46.5)), 2026, 1, NOW);
    expect(edits).toBe(4);
  });

  it('mentions only the players whose picks touch the game', async () => {
    repos.picks.upsert({
      guildId: GUILD,
      userId: 'picker',
      season: 2026,
      week: 1,
      category: 'OVER',
      gameId: 'g1',
      teamAbbr: null,
    });
    repos.games.upsertMany([{ ...game(), id: 'other' }]);
    repos.picks.upsert({
      guildId: GUILD,
      userId: 'bystander',
      season: 2026,
      week: 1,
      category: 'UNDER',
      gameId: 'other',
      teamAbbr: null,
    });

    await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 46.5)), 2026, 1, NOW);

    expect(sent[0]).toContain('<@picker> (OVER)');
    expect(sent[0]).not.toContain('bystander');
  });

  it('does not alert twice for the same move across runs', async () => {
    const espn = espnReturning(scoreboard(-2.5, 46.5));
    await runLineWatch(client, repos, espn, 2026, 1, NOW);
    // A restart, or simply the next scheduled scan, sees the same numbers.
    const second = await runLineWatch(client, repos, espn, 2026, 1, NOW);

    expect(second).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('alerts again when the line moves a second time', async () => {
    await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 46.5)), 2026, 1, NOW);
    await runLineWatch(client, repos, espnReturning(scoreboard(2, 46.5)), 2026, 1, NOW);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('swapped sides');
  });

  it('never touches a line once its game has started', async () => {
    repos.games.upsertMany([{ ...game(), state: 'in' }]);
    const applied = await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 41.5)), 2026, 1, NOW);

    expect(applied).toBe(0);
    expect(repos.lines.get('g1')?.spread).toBe(-7);
  });

  it('keeps the stored line when ESPN returns no odds, rather than reading it as a move to zero', async () => {
    // This is exactly what a completed game looks like, and what a transient
    // ESPN hiccup can look like too.
    const applied = await runLineWatch(
      client,
      repos,
      espnReturning(scoreboard(0, 0, 'post', [21, 24])),
      2026,
      1,
      NOW
    );

    expect(applied).toBe(0);
    expect(sent).toEqual([]);
    expect(repos.lines.get('g1')).toMatchObject({ spread: -7, overUnder: 46.5 });
  });

  it('records the move so /linemoves can show it', async () => {
    await runLineWatch(client, repos, espnReturning(scoreboard(-2.5, 41.5)), 2026, 1, NOW);

    const moves = repos.lineMoves.byWeek(2026, 1);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ old_spread: -7, new_spread: -2.5, reasons: 'SPREAD,TOTAL' });
  });
});
