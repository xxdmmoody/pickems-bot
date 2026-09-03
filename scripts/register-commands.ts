/**
 * Registers the slash commands with Discord.
 *
 * With DEV_GUILD_ID set the commands register to that guild and appear
 * instantly; without it they register globally, which Discord can take up to an
 * hour to roll out. Run this after changing any command definition.
 *
 *   npm run commands:register
 */
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { commandDefinitions } from '../src/interactions/commands.js';
import { logger } from '../src/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  const route = config.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DEV_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_APPLICATION_ID);

  await rest.put(route, { body: commandDefinitions });

  logger.info(
    { count: commandDefinitions.length, scope: config.DEV_GUILD_ID ? `guild ${config.DEV_GUILD_ID}` : 'global' },
    'registered slash commands'
  );
}

main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.stack : String(error) }, 'command registration failed');
  process.exit(1);
});
