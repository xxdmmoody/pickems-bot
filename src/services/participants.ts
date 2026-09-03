import type { Client } from 'discord.js';
import type { GuildConfig } from '../db/repos.js';
import { logger } from '../logger.js';

/**
 * Everyone currently holding the configured role.
 *
 * Membership is read live, per the decision that the role is the source of
 * truth: adding or dropping a player is just a role change. Bots are excluded.
 *
 * This needs the privileged GuildMembers intent, enabled in the Discord
 * developer portal — without it the member list comes back as only the cached
 * few, and the nudge would quietly miss people.
 */
export async function participantIds(client: Client, config: GuildConfig): Promise<string[]> {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const members = await guild.members.fetch();

    return members
      .filter((member) => !member.user.bot && member.roles.cache.has(config.roleId))
      .map((member) => member.id);
  } catch (error) {
    logger.error(
      { guildId: config.guildId, roleId: config.roleId, err: String(error) },
      'could not read participant role members'
    );
    return [];
  }
}
