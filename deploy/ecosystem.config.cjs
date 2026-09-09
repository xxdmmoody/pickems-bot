// pm2 configuration for PicksBot.
//
// This file is .cjs on purpose: package.json sets "type": "module", so a plain
// .js config would be loaded as ESM and pm2 expects CommonJS.
//
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//
const { resolve } = require('node:path');

// The repository root, derived from this file's own location rather than
// hardcoded. The bot reads .env and the SQLite database by relative path, so a
// wrong working directory surfaces as "no token" and an empty database rather
// than anything clearer — and a hardcoded path is the easiest way to get that
// wrong. Deriving it means this works wherever the repo is cloned, and keeps
// working after `pm2 resurrect` on reboot.
const ROOT = resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'pickems-bot',

      // Compiled output, not the TypeScript source — run `npm run build` first.
      script: 'dist/src/index.js',

      cwd: ROOT,

      // ---------------------------------------------------------------------
      // Both of these are load-bearing. Do not switch to cluster mode.
      //
      // A second instance would open a second Discord gateway connection and
      // run a second copy of every cron job, so the bot would post each week's
      // picks twice, alert twice, and have two processes writing to one SQLite
      // file. There is nothing to gain: this workload is a handful of messages
      // a week.
      // ---------------------------------------------------------------------
      instances: 1,
      exec_mode: 'fork',

      // If Node 22+ is not your system default, point pm2 at it directly so
      // this bot gets Node 22 while anything else you run under pm2 keeps the
      // version it was built against:
      //
      //   interpreter: '/home/pi/.nvm/versions/node/v22.23.2/bin/node',

      autorestart: true,
      // Wait before restarting so a crash loop (bad token, say) is visible in
      // the logs rather than spinning.
      restart_delay: 10000,
      max_restarts: 10,

      // The bot idles well under 100MB; this only catches a genuine leak.
      max_memory_restart: '400M',

      // Never enable watch: a file change would restart the gateway connection.
      watch: false,

      env: {
        NODE_ENV: 'production',
      },

      // Timestamp pm2's log lines. The bot's own logs are already structured
      // JSON with their own timestamps.
      time: true,
      merge_logs: true,
    },
  ],
};
