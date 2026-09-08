# PicksBot

A Discord bot for weekly NFL pick'em. Each week every player picks one **OVER**, one **UNDER**, one
**FAVORITE** to cover and one **UNDERDOG** to cover. The bot pulls the lines itself, posts the picks as
dropdowns, chases stragglers, grades the results and keeps season standings — replacing the spreadsheet
this game used to run on.

## How a week runs

| When (guild timezone, default America/Chicago) | What happens |
| --- | --- |
| **Tuesday 06:00** | Re-reads the schedule from ESPN before the week opens |
| **Tuesday 12:00** | Grades last week, posts results + standings + recap, fetches and snapshots the new week's lines, posts the schedule and the four pick messages tagging the participant role |
| **Thursday 12:00** and **Sunday 11:00** | Tags anyone still missing picks, naming what they owe |
| **every morning 08:00** | Re-reads the schedule; announces any kickoff that moved (see below) |
| **every night 21:00** | Scans for significant line movement, but only when games are due in the next 24h |
| every 15 minutes | Removes options for games that have kicked off |
| hourly | Refreshes scores while games are live or recently finished |
| **any time** | A player selects from a dropdown and gets a private confirmation |

## The rules it enforces

- **Lines freeze** when picks open Tuesday. Grading always uses the snapshot, never a refetch — which is
  also necessary, because ESPN drops a game's odds once it finals.
- **Pushes** (the number landing exactly) are neither a win nor a loss.
- **A missing pick is a loss.** Someone who picks nothing goes 0-4.
- **All four picks must be on four different games.** Enforced when you select, with an error naming the
  conflict.
- **Picks lock at kickoff.** You cannot pick a started game, and you cannot change a pick whose game has
  started. If you are incomplete you may still pick — just not from games already underway.

### Line movement

Injuries move lines, and a frozen Tuesday number can be badly stale by Sunday. The watcher runs the night
before each game day and treats a move as significant when the **spread swings 3+**, the **total swings
3+**, or the **favorite and underdog flip**. When one fires the bot updates that game's line for everyone,
edits the schedule and the dropdowns to match, and posts an alert @-mentioning only the players whose
picks touch that game.

"The night before each game day" is derived from the actual schedule, not a fixed set of weekdays: the
job runs every night at 21:00 and does nothing unless a game is due in the next 24 hours. NFL weeks are
not uniform — the 2026 season opens on a **Wednesday**, late-season weeks add Saturday games, and there
are Friday and holiday fixtures. A hardcoded Wed/Sat/Sun schedule would have missed all of them. Use
`/checklines` to run a scan immediately.

### Schedule changes

The schedule itself is not fixed once published. Sunday games get flex-scheduled into the night slot,
games move for weather, and the Christmas and end-of-season weeks land on unusual days. So the bot
re-reads the schedule from ESPN every morning at 08:00, again on Tuesday before the week opens, and once
more each night before it decides whether to scan lines.

When a kickoff moves by 30 minutes or more it posts a notice naming the game, the old and new times, and
the players who picked it, then rebuilds the pick dropdowns.

This is a correctness issue as much as a courtesy one: **picks lock at kickoff**, so a stale kickoff time
means the bot either locks a game early or keeps taking picks on a game already under way. A game that
moved earlier is called out prominently for the same reason. Everything downstream — which nights get a
line scan, when scores are refreshed, when options disappear — reads the stored schedule, so keeping it
accurate is what makes the rest adapt on its own. `/checkschedule` runs the check on demand.

Guards worth knowing: a line is never rewritten after kickoff; a game ESPN returns no odds for keeps its
stored line (a missing payload is never read as a move to zero); and alerts are unique per game and
number, so a restart mid-scan cannot double-post.

## Setup

### 1. Create the Discord application

1. At <https://discord.com/developers/applications>, create an application and add a bot.
2. Copy the **token** and the **application ID**.
3. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**. The bot reads the
   participant role to know who owes picks — without this it sees almost nobody.
4. Invite it with the `bot` and `applications.commands` scopes.

**Invite permissions.** Two options:

| | Permissions | What you get |
| --- | --- | --- |
| **Recommended** | View Channels, Send Messages, Mention Everyone, **Manage Channels**, **Manage Roles** | `/setup` creates the channel and role for you, and players self-enrol with `/join` |
| Minimal | View Channels, Send Messages, Mention Everyone | You create the channel and role yourself and assign the role to every player by hand |

Manage Channels and Manage Roles are only ever used to create `#pickems`, create `@Pickems`, and add or
remove that one role. Discord also prevents a bot from touching any role above its own, so PicksBot
cannot grant itself or anyone else elevated permissions.

### 2. Install and configure

Requires **Node 22 LTS or newer** — `better-sqlite3` publishes no prebuild for Node 20, so older versions
try to compile from source and need a full toolchain.

```bash
npm install
cp .env.example .env      # fill in DISCORD_TOKEN and DISCORD_APPLICATION_ID
npm run commands:register # set DEV_GUILD_ID first for instant registration while testing
npm run emojis:upload     # one-time: uploads the 32 team logos as application emojis
npm run build
npm start
```

`emojis:upload` is optional — without it the bot runs fine and messages fall back to plain team names.
Application-owned emojis work in every server the app joins and consume none of a server's own emoji
slots, which is what lets one set of logos serve all three guilds.

### 3. Configure each server

When the bot joins it posts a short welcome explaining what to do. An admin then runs:

```
/setup
```

That's the whole thing. With no arguments it finds or creates a `#pickems` channel and a `@Pickems`
role, saves the configuration, and posts a pinned **Join / leave the pool** button in the channel so
players enrol themselves — no need to hand the role out one by one.

To point it at your own channel or role instead, name either or both:

```
/setup channel:#football role:@Degenerates timezone:America/New_York
```

It reuses whatever you name and only creates what's missing, so it's safe to re-run at any time.

If the bot lacks Manage Channels or Manage Roles, `/setup` says exactly which permission is missing and
gives you the command to run once you've made the channel or role yourself. It also refuses a channel it
cannot post in, or a role sitting above its own in the hierarchy — both of which would otherwise fail
silently later.

Then post the first week whenever you like:

```
/openweek            # or just wait for Tuesday at noon
```

**Setting up mid-week?** `/openweek` picks up whatever week is live and posts every game that still has
a line, so a bot set up on a Tuesday evening — or a Thursday — works fine. Games that have already
kicked off simply don't appear in the dropdowns. When the Tuesday job next fires it notices the week was
already posted and won't duplicate it.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/setup` | admin | Set up the bot; creates the channel and role if you have none |
| `/join` · `/leave` | anyone | Join or leave the pool (same as the pinned button) |
| `/mypicks` | anyone | Your picks for the current week |
| `/standings` | anyone | Season standings |
| `/schedule` | anyone | This week's matchups and lines |
| `/results [week]` | anyone | Results for a week |
| `/whoneedstopick` | anyone | Who still owes picks |
| `/openweek [week]` | admin | Fetch lines and post a week's picks |
| `/gradeweek <week>` | admin | Grade or re-grade a week and post results |
| `/refreshodds [week]` | admin | Refetch scores and schedule from ESPN |
| `/linemoves [week]` | admin | Audit trail of applied line movements |
| `/checklines` | admin | Check for line movement now instead of waiting for tonight |
| `/checkschedule` | admin | Re-read the schedule now and announce any kickoff changes |

## Data source

Everything comes from ESPN's public (undocumented) JSON API — spreads, totals, kickoff times, final
scores, team logos, and bye weeks by derivation. No API key, no rate limit worries.

Two things to know about it:

- **Do not add browser-like headers.** ESPN's bot protection has been observed returning 403 to requests
  carrying `Origin`/`Referer`. `src/espn/client.ts` deliberately sends none.
- **`spread` is home-relative and signed.** Negative means the home team is favored (`SEA -3.5` →
  `-3.5`); positive means the away team is (`BAL -3.5` at IND → `+3.5`). This is what makes line-move
  detection a subtraction and a favorite flip a sign change.

Because the API is undocumented, every response is validated with zod at the boundary, and
`npm run espn:smoke` makes one live call to confirm the shape still holds. Run it before each season and
any time the data looks wrong.

## Development

```bash
npm test           # 187 tests, no network or Discord needed
npm run typecheck
npm run dev        # watch mode
npm run espn:smoke # live check that ESPN still returns what we depend on
npm run preview    # render every message for the live current week, no Discord
```

`npm run preview` is the fastest way to check formatting after a change: it pulls the real current week
from ESPN, prints the schedule, all four pick messages with their dropdown options, and a simulated
recap, results and standings — then asserts the invariants (a non-picker goes 0-4, every record accounts
for four picks, no message exceeds Discord's 2000-character limit).

The logic worth trusting lives in pure, dependency-free modules — `src/domain/` (grading, locking,
overlap, standings, line movement) and `src/render/` (every message format). They are tested against real
ESPN payloads captured in `src/espn/fixtures/`.

## Deployment (Raspberry Pi 5)

```bash
sudo cp deploy/pickems-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pickems-bot
journalctl -u pickems-bot -f
```

Edit the unit's `User`, `WorkingDirectory` and `ExecStart` paths first. Logs go to journald as JSON.

Back up `data/pickems.db` — it holds every pick, result and line snapshot:

```bash
sqlite3 data/pickems.db "VACUUM INTO 'data/backups/pickems-$(date +%F).db'"
```

## Architecture

```
src/
  domain/      pure rules: grading, lock, overlap, standings, line movement
  render/      pure message formatting for every message the bot posts
  espn/        API client (plain headers) + zod-validated mapper + fixtures
  db/          SQLite schema, migrations, repositories
  services/    week sync, pick submission, grading, posting, participants
  interactions/slash commands and the pick dropdown handler
  jobs/        scheduled work and the cron wiring
```

Pick dropdowns are routed through a single global `interactionCreate` handler keyed on `customId`, not
per-message collectors. Collectors die with the process; posted messages do not — so a week-old dropdown
still works after a restart or redeploy.
