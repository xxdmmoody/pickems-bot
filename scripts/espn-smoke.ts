/**
 * Live check that ESPN still returns what the bot depends on.
 *
 * The API is undocumented, so this is the early warning that its shape changed
 * mid-season. Run it before a season starts and any time the bot reports odd
 * data.
 *
 *   npm run espn:smoke
 */
import { EspnClient } from '../src/espn/client.js';
import { parseScoreboard, parseTeams } from '../src/espn/mapper.js';

async function main(): Promise<void> {
  const espn = new EspnClient();
  const failures: string[] = [];

  const teams = parseTeams(await espn.teams());
  report('teams endpoint returns 32 teams', teams.length === 32, `got ${teams.length}`, failures);
  report(
    'every team has a logo URL',
    teams.every((t) => t.logo.startsWith('https://')),
    'some logos missing',
    failures
  );

  const current = parseScoreboard(await espn.currentScoreboard());
  console.log(`\ncurrent: ${current.season} week ${current.week} — ${current.games.length} games`);

  report('scoreboard returns games', current.games.length > 0, 'no games', failures);

  const upcoming = current.games.filter((g) => g.state === 'pre');
  if (upcoming.length > 0) {
    const withLines = current.lines.length;
    report(
      'upcoming games carry odds',
      withLines > 0,
      'no game returned a spread and total — the odds shape may have changed',
      failures
    );

    // The whole line-move design rests on this sign convention.
    const sample = current.lines[0];
    const game = current.games.find((g) => g.id === sample?.gameId);
    if (sample && game) {
      const expected = sample.spread < 0 ? game.homeAbbr : game.awayAbbr;
      report(
        'spread is home-relative and signed',
        sample.favoriteAbbr === expected,
        `spread ${sample.spread} but favorite is ${sample.favoriteAbbr}`,
        failures
      );
      console.log(
        `  sample: ${game.awayAbbr} @ ${game.homeAbbr} — spread ${sample.spread}, O/U ${sample.overUnder}, favorite ${sample.favoriteAbbr}`
      );
    }
  } else {
    console.log('  (no upcoming games this week; odds checks skipped)');
  }

  report(
    'pre-game scores are null, not zero',
    upcoming.every((g) => g.awayScore === null),
    'a scheduled game reported a score',
    failures
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll ESPN checks passed.');
}

function report(label: string, ok: boolean, detail: string, failures: string[]): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

main().catch((error) => {
  console.error('smoke test failed:', error);
  process.exit(1);
});
