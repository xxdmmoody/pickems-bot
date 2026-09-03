/**
 * Renders every message the bot posts, using live ESPN data for the current
 * week, without touching Discord. Useful for checking formatting after a change
 * and as an end-to-end check of sync -> pick -> grade -> render.
 *
 *   npm run preview
 *
 * Team emojis appear as their `<:nfl_bal:id>` mention form if data/emoji-map.json
 * exists; otherwise messages fall back to plain team names, exactly as the bot
 * does before the emoji upload has been run.
 */
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/index.js';
import { createRepos } from '../src/db/repos.js';
import { TEAMS } from '../src/domain/teams.js';
import { CATEGORIES } from '../src/domain/types.js';
import { EspnClient } from '../src/espn/client.js';
import { parseScoreboard } from '../src/espn/mapper.js';
import { loadEmojiMap } from '../src/render/emoji.js';
import { buildOptions, renderPickMessage } from '../src/render/picks.js';
import { renderRecap } from '../src/render/recap.js';
import { renderResults, renderStandings } from '../src/render/results.js';
import { renderSchedule } from '../src/render/schedule.js';
import { gradeWeek } from '../src/services/grade.js';
import { submitPick } from '../src/services/picks.js';
import { byeTeams, loadWeek } from '../src/services/week.js';

const GUILD = 'preview';

async function main(): Promise<void> {
  try {
    loadEmojiMap(JSON.parse(readFileSync('data/emoji-map.json', 'utf8')));
  } catch {
    console.log('(no data/emoji-map.json — previewing with plain team names)\n');
  }

  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const espn = new EspnClient();

  const parsed = parseScoreboard(await espn.currentScoreboard());
  const { season, week } = parsed;
  repos.games.upsertMany(parsed.games);
  repos.lines.snapshotMany(parsed.lines);

  console.log(`${season} week ${week}: ${parsed.games.length} games, ${parsed.lines.length} with lines\n`);

  const entries = loadWeek(repos, season, week);
  const byes = byeTeams(repos, season, week, TEAMS.map((t) => t.abbr));

  section('SCHEDULE MESSAGE');
  console.log(renderSchedule(season, week, entries, byes));

  for (const category of CATEGORIES) {
    section(`PICK MESSAGE — ${category}`);
    console.log(renderPickMessage(category, entries.slice(0, 4)));
    console.log('\n  dropdown (one emoji, no markdown, home team in CAPS):');
    for (const option of buildOptions(category, entries.slice(0, 4))) {
      console.log(`    [${option.emojiAbbr}] ${option.label}   — ${option.description}`);
    }
  }

  // Simulate a played week: pick for three users, invent finals, then grade.
  section('SIMULATED WEEK');
  const openedAt = Math.min(...parsed.games.map((g) => g.kickoff)) - 86_400_000;
  const users = ['alice', 'bob', 'carol'];

  users.forEach((userId, u) => {
    CATEGORIES.forEach((category, c) => {
      const entry = entries[(u * CATEGORIES.length + c) % entries.length];
      if (!entry) return;
      const teamAbbr =
        category === 'FAVORITE'
          ? entry.line.favoriteAbbr
          : category === 'UNDERDOG'
            ? entry.line.underdogAbbr
            : null;

      const result = submitPick(
        repos,
        { guildId: GUILD, userId, season, week, category, gameId: entry.game.id, teamAbbr, timezone: 'America/Chicago' },
        openedAt
      );
      if (!result.ok) console.log(`  rejected: ${userId} ${category} — ${result.reason}`);
    });
  });

  // Invent finals so the recap and grading have something to work with.
  repos.games.upsertMany(
    parsed.games.map((g, i) => ({
      ...g,
      state: 'post' as const,
      awayScore: 17 + ((i * 7) % 21),
      homeScore: 20 + ((i * 5) % 17),
    }))
  );

  // "dave" holds the role but never picked — he should come out 0-4.
  const summary = gradeWeek(repos, GUILD, season, week, [...users, 'dave']);

  section('RECAP MESSAGE (with invented scores)');
  console.log(renderRecap(season, week, loadWeek(repos, season, week), byes));

  section('RESULTS MESSAGE');
  console.log(renderResults(week, repos.results.forWeek(GUILD, season, week)));

  section('STANDINGS MESSAGE');
  console.log(renderStandings(season, repos.results.season(GUILD, season)));

  section('CHECKS');
  const dave = summary.records.find((r) => r.userId === 'dave');
  check('a participant who never picked goes 0-4', dave?.wins === 0 && dave?.losses === 4);
  check(
    'every record accounts for exactly four picks',
    summary.records.every((r) => r.wins + r.losses + r.pushes === 4)
  );
  check(
    'each player used four distinct games',
    users.every((userId) => {
      const games = repos.picks.forUserWeek(GUILD, userId, season, week).map((p) => p.gameId);
      return new Set(games).size === games.length;
    })
  );
  check(
    'no message exceeds Discord’s 2000-character limit',
    [
      renderSchedule(season, week, entries, byes),
      renderRecap(season, week, loadWeek(repos, season, week), byes),
      ...CATEGORIES.map((c) => renderPickMessage(c, entries)),
    ].every((m) => m.length <= 2000)
  );
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(70)}\n${title}\n${'─'.repeat(70)}`);
}

function check(label: string, ok: boolean): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
