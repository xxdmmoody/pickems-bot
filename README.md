# PicksBot

A Discord bot for weekly NFL pick'em. Each week every player picks one **OVER**, one **UNDER**, one
**FAVORITE** to cover and one **UNDERDOG** to cover. The bot pulls the lines itself, posts the picks as
dropdowns, chases stragglers, grades the results and keeps season standings — replacing the spreadsheet
this game used to run on.

## How a week runs

| When (guild timezone, default America/Chicago) | What happens |
| --- | --- |
| **Tuesday 12:00** | Grades last week, posts results + standings + recap, fetches and snapshots the new week's lines, posts the schedule and the four pick messages tagging the participant role |
| **Thursday 12:00** and **Sunday 11:00** | Tags anyone still missing picks, naming what they owe |
| **Wed / Sat / Sun 21:00** | Scans for significant line movement (see below) |
| every 15 minutes | Removes options for games that have kicked off |
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

Guards worth knowing: a line is never rewritten after kickoff; a game ESPN returns no odds for keeps its
stored line (a missing payload is never read as a move to zero); and alerts are unique per game and
number, so a restart mid-scan cannot double-post.

## Setup

### 1. Create the Discord application

1. At <https://discord.com/developers/applications>, create an application and add a bot.
2. Copy the **token** and the **application ID**.
3. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**. The bot reads the
   participant role to know who owes picks — without this it sees almost nobody.
4. Invite it with the `bot` and `applications.commands` scopes and permissions to view the channel, send
   messages and mention roles.

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

```
/setup channel:#pickems role:@Pickems timezone:America/Chicago
/openweek            # posts the current week immediately
```

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/setup` | admin | Set the channel, participant role and timezone |
| `/mypicks` | anyone | Your picks for the current week |
| `/standings` | anyone | Season standings |
| `/schedule` | anyone | This week's matchups and lines |
| `/results [week]` | anyone | Results for a week |
| `/whoneedstopick` | anyone | Who still owes picks |
| `/openweek [week]` | admin | Fetch lines and post a week's picks |
| `/gradeweek <week>` | admin | Grade or re-grade a week and post results |
| `/refreshodds [week]` | admin | Refetch scores and schedule from ESPN |
| `/linemoves [week]` | admin | Audit trail of applied line movements |

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
npm test           # 144 tests, no network or Discord needed
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
