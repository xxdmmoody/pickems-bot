import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createRepos } from './db/repos.js';
import { EspnClient } from './espn/client.js';
import { handleCommand } from './interactions/commands.js';
import {
  findWelcomeChannel,
  handleJoinButton,
  renderWelcome,
  JOIN_BUTTON_ID,
} from './interactions/onboarding.js';
import { handlePickSelect } from './interactions/pick.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger } from './logger.js';
import { emojiMapSize, loadEmojiMap } from './render/emoji.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH);
  const repos = createRepos(db);
  const espn = new EspnClient();

  loadTeamEmojis(config.DATABASE_PATH);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Privileged: needed to read who holds the participant role. Enable it in
      // the Discord developer portal, or nudges and grading see nobody.
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info(
      { user: ready.user.tag, guilds: ready.guilds.cache.size, emojis: emojiMapSize() },
      'connected to Discord'
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, { client, repos, espn, defaultTimezone: config.DEFAULT_TIMEZONE });
        return;
      }

      // Pick dropdowns are routed here rather than through per-message
      // collectors, so week-old messages keep working across restarts.
      if (interaction.isStringSelectMenu()) {
        await handlePickSelect(interaction, repos, config.DEFAULT_TIMEZONE);
        return;
      }

      // The pinned join button, for the same reason.
      if (interaction.isButton() && interaction.customId === JOIN_BUTTON_ID) {
        await handleJoinButton(interaction, repos);
      }
    } catch (error) {
      logger.error({ err: String(error) }, 'unhandled interaction error');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      }
    }
  });

  // Greet a new server with what to do next. Without this the bot joins
  // silently and an admin has to already know `/setup` exists.
  client.on(Events.GuildCreate, async (guild) => {
    logger.info({ guildId: guild.id, name: guild.name }, 'added to guild');
    try {
      const channel = findWelcomeChannel(guild);
      if (channel) {
        await channel.send({ content: renderWelcome() });
      } else {
        logger.warn({ guildId: guild.id }, 'joined a guild with no channel I can post in');
      }
    } catch (error) {
      logger.warn({ guildId: guild.id, err: String(error) }, 'could not post welcome message');
    }
  });

  // Stop scheduling for a guild that removes the bot, rather than logging
  // "channel not found" every Tuesday forever.
  client.on(Events.GuildDelete, (guild) => {
    repos.guilds.deactivate(guild.id);
    logger.info({ guildId: guild.id }, 'removed from guild; deactivated its configuration');
  });

  await client.login(config.DISCORD_TOKEN);

  const tasks = startScheduler({ client, repos, espn }, config.DEFAULT_TIMEZONE);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    for (const task of tasks) task.stop();
    void client.destroy();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Loads the team emoji map written by `npm run emojis:upload`.
 *
 * Absent, the bot still runs and every message falls back to plain team names,
 * so a fresh install is usable before the upload has been done.
 */
function loadTeamEmojis(databasePath: string): void {
  const path = join(dirname(databasePath), 'emoji-map.json');
  try {
    loadEmojiMap(JSON.parse(readFileSync(path, 'utf8')));
    logger.info({ path, count: emojiMapSize() }, 'loaded team emojis');
  } catch {
    logger.warn({ path }, 'no team emoji map found; messages will use plain team names');
  }
}

main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.stack : String(error) }, 'failed to start');
  process.exit(1);
});
