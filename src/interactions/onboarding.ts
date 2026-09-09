import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type Role,
  type TextChannel,
} from 'discord.js';
import type { Repos } from '../db/repos.js';
import { logger } from '../logger.js';

/** Defaults used when an admin runs `/setup` without naming a channel or role. */
export const DEFAULT_CHANNEL_NAME = 'pickems';
export const DEFAULT_ROLE_NAME = 'Pickems';

export const JOIN_BUTTON_ID = 'pickems:join';

/* ------------------------------------------------------- resource resolution */

export type Resolution<T> =
  | { ok: true; value: T; action: 'provided' | 'reused' | 'created'; warning?: string }
  | { ok: false; reason: string };

/**
 * Finds or creates the channel the bot will post in.
 *
 * Preference order: what the admin named, an existing #pickems, then a new one.
 * Creating requires Manage Channels; when that is missing the error says exactly
 * what to do instead, rather than failing with a bare permissions message.
 */
export async function resolveSetupChannel(
  guild: Guild,
  provided: TextChannel | null
): Promise<Resolution<TextChannel>> {
  if (provided) {
    const problem = channelUsabilityProblem(guild, provided);
    return problem ? { ok: false, reason: problem } : { ok: true, value: provided, action: 'provided' };
  }

  const existing = guild.channels.cache.find(
    (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === DEFAULT_CHANNEL_NAME
  );
  if (existing) {
    const problem = channelUsabilityProblem(guild, existing);
    return problem ? { ok: false, reason: problem } : { ok: true, value: existing, action: 'reused' };
  }

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return {
      ok: false,
      reason:
        `I need the **Manage Channels** permission to create #${DEFAULT_CHANNEL_NAME} for you.\n` +
        'Either grant it and run `/setup` again, or create the channel yourself and run ' +
        '`/setup channel:#your-channel`.',
    };
  }

  try {
    const created = await guild.channels.create({
      name: DEFAULT_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: 'Weekly NFL pick\'em — picks, results and standings.',
      reason: 'PicksBot setup',
    });
    return { ok: true, value: created, action: 'created' };
  } catch (error) {
    logger.error({ guildId: guild.id, err: String(error) }, 'could not create channel');
    return { ok: false, reason: 'I could not create the channel. Create it and run `/setup channel:#your-channel`.' };
  }
}

/** The bot must be able to both see and post in the channel, or nothing works. */
function channelUsabilityProblem(guild: Guild, channel: TextChannel): string | null {
  const me = guild.members.me;
  if (!me) return null;

  const permissions = channel.permissionsFor(me);
  const missing: string[] = [];
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
  if (!permissions?.has(PermissionFlagsBits.SendMessages)) missing.push('Send Messages');

  if (missing.length === 0) return null;
  return (
    `I cannot post in <#${channel.id}> — I am missing **${missing.join('** and **')}** there.\n` +
    'Fix the channel permissions and run `/setup` again.'
  );
}

/**
 * Finds or creates the participant role.
 *
 * A newly created role lands at the bottom of the hierarchy, below the bot's own
 * role, which is what lets the bot assign it through `/join`. A pre-existing role
 * positioned above the bot cannot be assigned, so that is checked up front rather
 * than discovered by every player who tries to join.
 */
export async function resolveSetupRole(guild: Guild, provided: Role | null): Promise<Resolution<Role>> {
  // A role that already exists is usable even if the bot cannot assign it. The
  // game only needs to *read* who holds the role, which comes from the members
  // intent, not from Manage Roles. Losing the ability to assign costs the
  // self-service /join button, not the season — so this warns rather than
  // blocking setup, which matters when whoever is installing the bot cannot
  // grant that permission and the server owner is unavailable.
  if (provided) {
    return { ok: true, value: provided, action: 'provided', ...warn(guild, provided) };
  }

  const existing = guild.roles.cache.find((r) => r.name === DEFAULT_ROLE_NAME);
  if (existing) {
    return { ok: true, value: existing, action: 'reused', ...warn(guild, existing) };
  }

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return {
      ok: false,
      reason:
        `I need the **Manage Roles** permission to create the @${DEFAULT_ROLE_NAME} role.\n` +
        'Either grant it and run `/setup` again, or create the role yourself and run ' +
        '`/setup role:@your-role`.',
    };
  }

  try {
    const created = await guild.roles.create({
      name: DEFAULT_ROLE_NAME,
      mentionable: true,
      reason: 'PicksBot setup',
    });
    return { ok: true, value: created, action: 'created' };
  } catch (error) {
    logger.error({ guildId: guild.id, err: String(error) }, 'could not create role');
    return { ok: false, reason: 'I could not create the role. Create it and run `/setup role:@your-role`.' };
  }
}

/**
 * Whether the bot can hand this role out.
 *
 * Two separate requirements, both of which Discord enforces: the Manage Roles
 * permission, and the role sitting strictly below the bot's own highest role.
 */
export function canAssignRole(guild: Guild, role: Role): boolean {
  const me = guild.members.me;
  if (!me) return false;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  return me.roles.highest.comparePositionTo(role) > 0;
}

/** Explains why the bot cannot assign a role, or null when it can. */
function roleAssignmentProblem(guild: Guild, role: Role): string | null {
  const me = guild.members.me;
  if (!me) return null;

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return (
      `I do not have **Manage Roles**, so I cannot add or remove @${role.name} myself. ` +
      'Everything else works — scores, standings, reminders — but somebody with the permission ' +
      'has to give players the role by hand. Grant it later and re-run `/setup` to enable `/join`.'
    );
  }

  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return (
      `@${role.name} sits above my own role, so Discord will not let me assign it. ` +
      'Drag my role above it in **Server Settings → Roles** and re-run `/setup` to enable `/join`. ' +
      'Until then the role has to be given out by hand.'
    );
  }

  return null;
}

/** Shapes the assignment problem as the optional `warning` on a Resolution. */
function warn(guild: Guild, role: Role): { warning?: string } {
  const problem = roleAssignmentProblem(guild, role);
  return problem ? { warning: problem } : {};
}

/**
 * Looks up a previously configured channel, or null if it has been deleted.
 *
 * Used so that re-running `/setup` to change one setting keeps the others.
 * Without this, `/setup timezone:...` would treat the omitted channel as "find
 * or create #pickems" and silently move the bot out of the channel the server
 * had been using.
 */
export async function storedChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
    return channel && channel.type === ChannelType.GuildText ? (channel as TextChannel) : null;
  } catch {
    // Deleted, or no longer visible to the bot. Either way the caller should
    // fall back to find-or-create rather than fail the whole setup.
    return null;
  }
}

/** The role counterpart of `storedChannel`. */
export async function storedRole(guild: Guild, roleId: string): Promise<Role | null> {
  try {
    return guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId));
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- messaging */

/** Posted automatically when the bot joins a server. */
export function renderWelcome(): string {
  return [
    "👋 **Thanks for adding PicksBot!**",
    '',
    "Every week each player picks one **OVER**, one **UNDER**, one **FAVORITE** to cover and one",
    '**UNDERDOG** to cover. I pull the lines myself, post the picks as dropdowns, chase anyone who',
    'forgets, and keep the standings.',
    '',
    '**To get started, an admin runs:**',
    '```',
    '/setup',
    '```',
    "I will create a #pickems channel and a @Pickems role if you don't already have them, or you can",
    'point me at your own with `/setup channel:#somewhere role:@somerole`.',
    '',
    'After that, players join with `/join` — or the button I post in the picks channel.',
  ].join('\n');
}

/** The confirmation shown after a successful `/setup`. */
export function renderSetupSummary(
  channel: TextChannel,
  role: Role,
  timezone: string,
  channelAction: string,
  roleAction: string,
  roleWarning?: string
): string {
  const describe = (action: string, what: string) => {
    if (action === 'created') return `✨ Created ${what}`;
    if (action === 'reused') return `♻️ Using existing ${what}`;
    return `✅ Using ${what}`;
  };

  const lines = [
    '**PicksBot is set up.**',
    '',
    describe(channelAction, `<#${channel.id}> for picks and results`),
    describe(roleAction, `<@&${role.id}> as the players role`),
    `🕒 Times are ${timezone}`,
  ];

  if (roleWarning) {
    lines.push('', `⚠️ ${roleWarning}`);
  }

  lines.push('', '**Next:**');
  lines.push(
    roleWarning
      ? `• Give players the <@&${role.id}> role, then they can pick`
      : `• Players join with \`/join\` (or the button in <#${channel.id}>)`
  );
  lines.push('• Run `/openweek` to post this week immediately, or wait for Tuesday at noon');

  return lines.join('\n');
}

/** The message carrying the join button, posted into the picks channel at setup. */
export function renderJoinPrompt(roleId: string): string {
  return [
    '🏈 **Join the pick\'em pool**',
    '',
    `Press the button below to get <@&${roleId}> and start making picks each week.`,
    'Press it again any time to leave.',
  ].join('\n');
}

export function buildJoinRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(JOIN_BUTTON_ID)
      .setLabel('Join / leave the pool')
      .setEmoji('🏈')
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Handles the join button: a toggle, so one persistent message serves both
 * joining and leaving without needing separate buttons or a second message.
 */
export async function handleJoinButton(interaction: ButtonInteraction, repos: Repos): Promise<void> {
  if (!interaction.guildId || !interaction.guild) return;

  const config = repos.guilds.get(interaction.guildId);
  if (!config) {
    await interaction.reply({
      content: 'This server is not set up yet — an admin needs to run `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await toggleParticipation(interaction.guild, config.roleId, interaction.user.id);
  await interaction.reply({ content: result, flags: MessageFlags.Ephemeral });
}

/** Adds or removes the participant role, returning what to tell the player. */
export async function toggleParticipation(
  guild: Guild,
  roleId: string,
  userId: string,
  force?: 'join' | 'leave'
): Promise<string> {
  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) {
    return '❌ The players role has been deleted. An admin needs to run `/setup` again.';
  }

  const problem = roleAssignmentProblem(guild, role);
  if (problem) return `❌ ${problem}`;

  try {
    const member = await guild.members.fetch(userId);
    const hasRole = member.roles.cache.has(roleId);
    const shouldLeave = force ? force === 'leave' : hasRole;

    if (shouldLeave) {
      if (!hasRole) return "You are not in the pool, so there is nothing to leave.";
      await member.roles.remove(role, 'PicksBot: left the pool');
      return `👋 You have left the pool. Your results so far are kept — press the button or run \`/join\` to come back.`;
    }

    if (hasRole) return "You are already in the pool — you will be tagged when picks open.";
    await member.roles.add(role, 'PicksBot: joined the pool');
    return `🏈 You are in! You will be tagged when picks open. Use \`/mypicks\` any time to see your slate.`;
  } catch (error) {
    logger.error({ guildId: guild.id, userId, err: String(error) }, 'could not change participation');
    return '❌ I could not change your role. An admin may need to move my role above the players role.';
  }
}

/** Best channel to greet a new server in: the system channel, else the first writable one. */
export function findWelcomeChannel(guild: Guild): TextChannel | null {
  const me = guild.members.me;
  if (!me) return null;

  const canPost = (channel: TextChannel) =>
    channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) ??
    false;

  if (guild.systemChannel && canPost(guild.systemChannel)) return guild.systemChannel;

  return (
    guild.channels.cache
      .filter((c): c is TextChannel => c.type === ChannelType.GuildText && canPost(c))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first() ?? null
  );
}
