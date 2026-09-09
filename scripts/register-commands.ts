/**
 * Registers the slash commands with Discord.
 *
 * With DEV_GUILD_ID set the commands register to that guild and appear
 * instantly; without it they register globally, which Discord can take up to an
 * hour to roll out. Run this after changing any command definition.
 *
 *   node dist/scripts/register-commands.js     (on a server)
 *   npm run commands:register                  (in development)
 */
import { PermissionFlagsBits, REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { commandDefinitions } from '../src/interactions/commands.js';
import { logger } from '../src/logger.js';

/**
 * What the bot needs to do its job. Two of these are easy to overlook and fail
 * quietly rather than loudly:
 *
 *   ReadMessageHistory  needed to fetch a message it posted earlier, which is
 *                       how locked options are removed from a dropdown and how
 *                       a line move updates the numbers already on screen.
 *   ManageMessages      needed to pin the join prompt during /setup.
 *
 * ManageChannels and ManageRoles are only for creating #pickems and @Pickems
 * and handing out that one role; drop them if you would rather set those up by
 * hand.
 */
const REQUIRED_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles;

interface CurrentApplication {
  id: string;
  name: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  // Confirm the token works and belongs to the configured application BEFORE
  // attempting to register. Otherwise a mismatch surfaces as a bare
  // "50001 Missing Access", which reads like a permissions problem and sends
  // you looking in entirely the wrong place.
  let app: CurrentApplication;
  try {
    app = (await rest.get(Routes.currentApplication())) as CurrentApplication;
  } catch (error) {
    throw new Error(
      'Could not authenticate with that token. Check DISCORD_TOKEN — it is the value from the ' +
        'Bot tab ("Reset Token"), not the Public Key or Client Secret.\n' +
        `  Discord said: ${describe(error)}`
    );
  }

  if (app.id !== config.DISCORD_APPLICATION_ID) {
    throw new Error(
      'DISCORD_TOKEN and DISCORD_APPLICATION_ID belong to different applications.\n' +
        `  The token belongs to "${app.name}" (id ${app.id}).\n` +
        `  DISCORD_APPLICATION_ID is set to ${config.DISCORD_APPLICATION_ID}.\n` +
        `  Fix: set DISCORD_APPLICATION_ID=${app.id}, or use the token from the other application.`
    );
  }

  logger.info({ application: app.name, id: app.id }, 'authenticated');

  const route = config.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(app.id, config.DEV_GUILD_ID)
    : Routes.applicationCommands(app.id);

  try {
    await rest.put(route, { body: commandDefinitions });
  } catch (error) {
    throw new Error(explainRegistrationFailure(error, config.DEV_GUILD_ID, app.id));
  }

  logger.info(
    {
      count: commandDefinitions.length,
      scope: config.DEV_GUILD_ID ? `guild ${config.DEV_GUILD_ID}` : 'global',
    },
    'registered slash commands'
  );

  if (!config.DEV_GUILD_ID) {
    logger.info('global commands can take up to an hour to appear in every server');
  }

  console.log(`\nInvite the bot with this URL:\n\n  ${inviteUrl(app.id)}\n`);
}

/** Turns the two realistic causes of a failed registration into instructions. */
function explainRegistrationFailure(error: unknown, devGuildId: string | undefined, appId: string): string {
  const missingAccess = String(error).includes('50001');

  if (missingAccess && devGuildId) {
    return (
      `Missing Access registering to guild ${devGuildId}.\n` +
      '  Guild commands require the bot to already be in that server, invited with the\n' +
      '  applications.commands scope.\n' +
      `  Fix: invite it first — ${inviteUrl(appId)}\n` +
      '  Or clear DEV_GUILD_ID to register globally, which works before the bot joins anywhere.'
    );
  }

  if (missingAccess) {
    return (
      'Missing Access registering global commands.\n' +
      '  The token was accepted, so this usually means the application is in an unexpected\n' +
      '  state — check that the bot user still exists under this application in the portal.\n' +
      `  Discord said: ${describe(error)}`
    );
  }

  return `Registration failed: ${describe(error)}`;
}

function inviteUrl(applicationId: string): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot applications.commands',
    permissions: REQUIRED_PERMISSIONS.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  logger.fatal(describe(error));
  process.exit(1);
});
