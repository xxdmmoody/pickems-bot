import { ChannelType, type Client } from 'discord.js';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { createRepos, type Repos } from '../db/repos.js';
import { EspnClient } from '../espn/client.js';
import { loadEmojiMap } from '../render/emoji.js';
import { runScheduleSync } from './scheduleSync.js';
import { runScoreRefresh } from './weekly.js';

const CT = 'America/Chicago';
const GUILD = 'guild-1';

let repos: Repos;
let sent: string[];
let client: Client;

function ct(iso: string): number {
  return DateTime.fromISO(iso, { zone: CT }).toMillis();
}

/** One-game scoreboard payload with a controllable kickoff and state. */
function scoreboard(kickoff: number, state: 'pre' | 'in' | 'post' = 'pre', scores?: [number, number]) {
  return {
    season: { year: 2026, type: 2 },
    week: { number: 1 },
    events: [
      {
        id: 'g1',
        date: new Date(kickoff).toISOString(),
        status: { type: { state } },
        competitions: [
          {
            competitors: [
              { homeAway: 'home', score: String(scores?.[1] ?? 0), team: { abbreviation: 'MIA' } },
              { homeAway: 'away', score: String(scores?.[0] ?? 0), team: { abbreviation: 'BAL' } },
            ],
            odds: [{ spread: -7, overUnder: 46.5, provider: { id: '100', name: 'DK', priority: 1 } }],
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

const ORIGINAL_KICKOFF = ct('2026-09-13T12:00');

beforeEach(() => {
  loadEmojiMap({});
  repos = createRepos(openDatabase(':memory:'));
  sent = [];

  repos.guilds.upsert({ guildId: GUILD, channelId: 'c1', roleId: 'r1', timezone: CT });
  repos.games.upsertMany([
    {
      id: 'g1',
      season: 2026,
      week: 1,
      awayAbbr: 'BAL',
      homeAbbr: 'MIA',
      kickoff: ORIGINAL_KICKOFF,
      state: 'pre',
      awayScore: null,
      homeScore: null,
    },
  ]);

  const channel = {
    id: 'c1',
    type: ChannelType.GuildText,
    send: async ({ content }: { content: string }) => {
      sent.push(content);
      return { id: `m${sent.length}` };
    },
    messages: { fetch: async () => ({ content: '', edit: async () => undefined }) },
  };
  client = { channels: { fetch: async () => channel } } as unknown as Client;
});

describe('runScheduleSync', () => {
  it('says nothing when the schedule is unchanged', async () => {
    const changes = await runScheduleSync(client, repos, espnReturning(scoreboard(ORIGINAL_KICKOFF)), 2026, 1);

    expect(changes).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('ignores a trivial timestamp tweak', async () => {
    // ESPN nudging a time by ten minutes is not a schedule change.
    const changes = await runScheduleSync(
      client,
      repos,
      espnReturning(scoreboard(ORIGINAL_KICKOFF + 10 * 60_000)),
      2026,
      1
    );

    expect(changes).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('detects a flex move into the Sunday night slot and announces it', async () => {
    const flexed = ct('2026-09-13T19:20');
    const changes = await runScheduleSync(client, repos, espnReturning(scoreboard(flexed)), 2026, 1);

    expect(changes).toHaveLength(1);
    expect(repos.games.get('g1')?.kickoff).toBe(flexed);
    expect(sent[0]).toContain('Schedule change');
    expect(sent[0]).toContain('7h 20m later');
  });

  it('warns prominently when a game moves earlier, since it locks sooner', async () => {
    const earlier = ct('2026-09-12T19:15'); // moved to Saturday night
    await runScheduleSync(client, repos, espnReturning(scoreboard(earlier)), 2026, 1);

    expect(sent[0]).toContain('locks sooner than it used to');
  });

  it('mentions the players who picked the moved game', async () => {
    repos.picks.upsert({
      guildId: GUILD,
      userId: 'picker',
      season: 2026,
      week: 1,
      category: 'OVER',
      gameId: 'g1',
      teamAbbr: null,
    });

    await runScheduleSync(client, repos, espnReturning(scoreboard(ct('2026-09-13T19:20'))), 2026, 1);
    expect(sent[0]).toContain('<@picker> (OVER)');
  });

  it('does not re-announce the same change on the next run', async () => {
    const flexed = ct('2026-09-13T19:20');
    const espn = espnReturning(scoreboard(flexed));

    await runScheduleSync(client, repos, espn, 2026, 1);
    const second = await runScheduleSync(client, repos, espn, 2026, 1);

    // The first run stored the new time, so the second sees no difference.
    expect(second).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it('ignores a game that has already started', async () => {
    repos.games.upsertMany([
      {
        id: 'g1',
        season: 2026,
        week: 1,
        awayAbbr: 'BAL',
        homeAbbr: 'MIA',
        kickoff: ORIGINAL_KICKOFF,
        state: 'in',
        awayScore: 7,
        homeScore: 0,
      },
    ]);

    const changes = await runScheduleSync(
      client,
      repos,
      espnReturning(scoreboard(ct('2026-09-13T19:20'), 'in', [7, 0])),
      2026,
      1
    );

    expect(changes).toHaveLength(0);
  });
});

describe('runScoreRefresh gating', () => {
  const ctx = () => ({ client, repos, espn: espnReturning(scoreboard(ORIGINAL_KICKOFF, 'post', [21, 24])) });

  it('skips when no game has kicked off yet', async () => {
    await runScoreRefresh(ctx(), ORIGINAL_KICKOFF - 60 * 60_000);
    // Nothing fetched, so the stored game is untouched.
    expect(repos.games.get('g1')?.state).toBe('pre');
  });

  it('refreshes while a game is recently under way', async () => {
    await runScoreRefresh(ctx(), ORIGINAL_KICKOFF + 60 * 60_000);
    expect(repos.games.get('g1')?.state).toBe('post');
  });

  it('refreshes on a Wednesday, which the old weekday-pinned cron never did', async () => {
    const wednesdayKickoff = ct('2026-09-09T19:20');
    repos.games.upsertMany([
      {
        id: 'g1',
        season: 2026,
        week: 1,
        awayAbbr: 'BAL',
        homeAbbr: 'MIA',
        kickoff: wednesdayKickoff,
        state: 'pre',
        awayScore: null,
        homeScore: null,
      },
    ]);

    const espn = espnReturning(scoreboard(wednesdayKickoff, 'post', [21, 24]));
    await runScoreRefresh({ client, repos, espn }, wednesdayKickoff + 2 * 60 * 60_000);

    expect(repos.games.get('g1')?.state).toBe('post');
    expect(repos.games.get('g1')?.homeScore).toBe(24);
  });

  it('stops refreshing long after the last game', async () => {
    repos.games.upsertMany([
      {
        id: 'g1',
        season: 2026,
        week: 1,
        awayAbbr: 'BAL',
        homeAbbr: 'MIA',
        kickoff: ORIGINAL_KICKOFF,
        state: 'post',
        awayScore: 21,
        homeScore: 24,
      },
    ]);

    // A day later there is nothing live and the score is already final.
    await runScoreRefresh(ctx(), ORIGINAL_KICKOFF + 24 * 60 * 60_000);
    expect(repos.games.get('g1')?.homeScore).toBe(24);
  });
});
