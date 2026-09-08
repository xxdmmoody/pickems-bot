import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Role,
  type TextChannel,
} from 'discord.js';
import type { Repos } from '../db/repos.js';
import { TEAMS, nickname } from '../domain/teams.js';
import type { EspnClient } from '../espn/client.js';
import { logger } from '../logger.js';
import { renderResults, renderStandings } from '../render/results.js';
import { renderSchedule } from '../render/schedule.js';
import {
  buildJoinRow,
  renderJoinPrompt,
  renderSetupSummary,
  resolveSetupChannel,
  resolveSetupRole,
  toggleParticipation,
} from './onboarding.js';
import { runLineWatch } from '../jobs/lineWatch.js';
import { gradeWeek } from '../services/grade.js';
import { participantIds } from '../services/participants.js';
import { describeSlate, findIncomplete } from '../services/picks.js';
import { postWeek, postResultsAndStandings, postRecap } from '../services/poster.js';
import {
  byeTeams,
  currentWeek,
  loadWeek,
  resolveWeekToOpen,
  syncWeek,
  FIRST_WEEK,
  LAST_WEEK,
} from '../services/week.js';

const adminOnly = PermissionFlagsBits.ManageGuild;

const weekOption = (required: boolean) => (option: any) =>
  option
    .setName('week')
    .setDescription('NFL regular season week (1-18)')
    .setMinValue(FIRST_WEEK)
    .setMaxValue(LAST_WEEK)
    .setRequired(required);

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up the bot — creates a channel and role for you if you have none')
    .setDefaultMemberPermissions(adminOnly)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Existing channel to post in (default: find or create #pickems)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption((o) =>
      o
        .setName('role')
        .setDescription('Existing players role (default: find or create @Pickems)')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('timezone').setDescription('IANA timezone, e.g. America/Chicago').setRequired(false)
    ),

  new SlashCommandBuilder().setName('join').setDescription('Join the pick’em pool'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the pick’em pool'),
  new SlashCommandBuilder().setName('mypicks').setDescription('Show your picks for this week'),
  new SlashCommandBuilder().setName('standings').setDescription('Show the season standings'),
  new SlashCommandBuilder().setName('schedule').setDescription('Show this week’s matchups and lines'),
  new SlashCommandBuilder()
    .setName('results')
    .setDescription('Show the results for a week')
    .addIntegerOption(weekOption(false)),
  new SlashCommandBuilder()
    .setName('whoneedstopick')
    .setDescription('List players who still owe picks this week'),

  new SlashCommandBuilder()
    .setName('openweek')
    .setDescription('Admin: fetch lines and post the picks for a week')
    .setDefaultMemberPermissions(adminOnly)
    .addIntegerOption(weekOption(false)),
  new SlashCommandBuilder()
    .setName('gradeweek')
    .setDescription('Admin: grade (or re-grade) a week and post results')
    .setDefaultMemberPermissions(adminOnly)
    .addIntegerOption(weekOption(true)),
  new SlashCommandBuilder()
    .setName('refreshodds')
    .setDescription('Admin: refetch scores and lines from ESPN for a week')
    .setDefaultMemberPermissions(adminOnly)
    .addIntegerOption(weekOption(false)),
  new SlashCommandBuilder()
    .setName('linemoves')
    .setDescription('Admin: show recorded line movements for a week')
    .setDefaultMemberPermissions(adminOnly)
    .addIntegerOption(weekOption(false)),
  new SlashCommandBuilder()
    .setName('checklines')
    .setDescription('Admin: check for significant line movement now, instead of waiting for tonight')
    .setDefaultMemberPermissions(adminOnly),
].map((builder) => builder.toJSON());

export interface CommandContext {
  client: Client;
  repos: Repos;
  espn: EspnClient;
  defaultTimezone: string;
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'setup':
        return await handleSetup(interaction, ctx);
      case 'join':
        return await handleParticipation(interaction, ctx, 'join');
      case 'leave':
        return await handleParticipation(interaction, ctx, 'leave');
      case 'mypicks':
        return await handleMyPicks(interaction, ctx);
      case 'standings':
        return await handleStandings(interaction, ctx);
      case 'schedule':
        return await handleSchedule(interaction, ctx);
      case 'results':
        return await handleResults(interaction, ctx);
      case 'whoneedstopick':
        return await handleWhoNeedsToPick(interaction, ctx);
      case 'openweek':
        return await handleOpenWeek(interaction, ctx);
      case 'gradeweek':
        return await handleGradeWeek(interaction, ctx);
      case 'refreshodds':
        return await handleRefreshOdds(interaction, ctx);
      case 'linemoves':
        return await handleLineMoves(interaction, ctx);
      case 'checklines':
        return await handleCheckLines(interaction, ctx);
      default:
        await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    logger.error({ command: interaction.commandName, err: String(error) }, 'command failed');
    await respond(interaction, '❌ Something went wrong. Check the bot logs.');
  }
}

/* ------------------------------------------------------------------ helpers */

/** Replies, or edits the deferred reply if the handler already deferred. */
async function respond(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

function requireConfig(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
  const config = ctx.repos.guilds.get(interaction.guildId!);
  return config;
}

/** The week a command should act on: the given option, or the latest stored week. */
function resolveWeek(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): { season: number; week: number } | null {
  const latest = ctx.repos.games.latestWeek();
  if (!latest) return null;

  const explicit = interaction.options.getInteger('week');
  return explicit ? { season: latest.season, week: explicit } : latest;
}

/* ----------------------------------------------------------------- handlers */

/**
 * Sets the bot up, creating the channel and role when the admin has none.
 *
 * Both options are optional: with neither, the bot finds or creates #pickems and
 * @Pickems, so onboarding is a single command with no prerequisites. Naming an
 * existing channel or role still works and skips creation.
 */
async function handleSetup(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const timezone = interaction.options.getString('timezone') ?? ctx.defaultTimezone;
  if (!isValidTimezone(timezone)) {
    await respond(interaction, `❌ \`${timezone}\` is not a valid IANA timezone.`);
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  // Creating a channel or role can take a moment; defer so the token holds.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const providedChannel = interaction.options.getChannel('channel') as TextChannel | null;
  const channelResult = await resolveSetupChannel(guild, providedChannel);
  if (!channelResult.ok) {
    await respond(interaction, `❌ ${channelResult.reason}`);
    return;
  }

  const providedRole = interaction.options.getRole('role');
  const roleResult = await resolveSetupRole(guild, providedRole as Role | null);
  if (!roleResult.ok) {
    await respond(interaction, `❌ ${roleResult.reason}`);
    return;
  }

  const channel = channelResult.value;
  const role = roleResult.value;

  ctx.repos.guilds.upsert({
    guildId: guild.id,
    channelId: channel.id,
    roleId: role.id,
    timezone,
  });

  // A persistent join button means players enrol themselves rather than an admin
  // handing out the role one by one.
  try {
    const prompt = await channel.send({
      content: renderJoinPrompt(role.id),
      components: [buildJoinRow()],
    });
    await prompt.pin().catch(() => undefined);
  } catch (error) {
    logger.warn({ guildId: guild.id, err: String(error) }, 'could not post the join prompt');
  }

  await respond(
    interaction,
    renderSetupSummary(channel, role, timezone, channelResult.action, roleResult.action)
  );
}

/** `/join` and `/leave` — the command equivalents of the join button. */
async function handleParticipation(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext,
  action: 'join' | 'leave'
): Promise<void> {
  const config = requireConfig(interaction, ctx);
  if (!config || !interaction.guild) {
    await respond(interaction, 'This server is not set up yet — an admin needs to run `/setup`.');
    return;
  }

  const message = await toggleParticipation(interaction.guild, config.roleId, interaction.user.id, action);
  await respond(interaction, message);
}

async function handleMyPicks(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been opened yet.');
    return;
  }

  const picks = ctx.repos.picks.forUserWeek(
    interaction.guildId!,
    interaction.user.id,
    target.season,
    target.week
  );

  if (picks.length === 0) {
    await respond(interaction, `You have not made any picks for Week ${target.week} yet.`);
    return;
  }

  const lines = [`**Your Week ${target.week} picks**`, '', ...describeSlate(ctx.repos, picks)];
  if (picks.length < 4) lines.push('', `_${4 - picks.length} still to make._`);
  await respond(interaction, lines.join('\n'));
}

async function handleStandings(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const season = ctx.repos.games.latestWeek()?.season ?? new Date().getFullYear();
  const totals = ctx.repos.results.season(interaction.guildId!, season);
  await respond(interaction, renderStandings(season, totals));
}

async function handleSchedule(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been opened yet.');
    return;
  }

  const entries = loadWeek(ctx.repos, target.season, target.week);
  const byes = byeTeams(ctx.repos, target.season, target.week, TEAMS.map((t) => t.abbr));
  await respond(interaction, renderSchedule(target.season, target.week, entries, byes));
}

async function handleResults(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been graded yet.');
    return;
  }

  const weekly = ctx.repos.results.forWeek(interaction.guildId!, target.season, target.week);
  await respond(interaction, renderResults(target.week, weekly));
}

async function handleWhoNeedsToPick(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const config = requireConfig(interaction, ctx);
  if (!config) {
    await respond(interaction, 'This server has not been set up. Run `/setup` first.');
    return;
  }

  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been opened yet.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const participants = await participantIds(ctx.client, config);
  const incomplete = findIncomplete(ctx.repos, config.guildId, target.season, target.week, participants);

  if (incomplete.length === 0) {
    await respond(interaction, `Everyone is locked in for Week ${target.week}. 🏈`);
    return;
  }

  const lines = incomplete.map((m) => `<@${m.userId}> — ${m.categories.join(', ')}`);
  await respond(interaction, [`**Still to pick — Week ${target.week}**`, '', ...lines].join('\n'));
}

async function handleOpenWeek(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const config = requireConfig(interaction, ctx);
  if (!config) {
    await respond(interaction, 'This server has not been set up. Run `/setup` first.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Same resolution the Tuesday job uses, so running this manually a few days
  // into a week does not re-open the week that just finished.
  const target = await resolveWeekToOpen(ctx.espn, ctx.repos);
  const explicit = interaction.options.getInteger('week');
  const season = target.season;
  const week = explicit ?? target.week;

  await syncWeek(ctx.espn, ctx.repos, season, week);
  await postWeek(ctx.client, ctx.repos, config, season, week);

  const entries = loadWeek(ctx.repos, season, week);
  await respond(
    interaction,
    `✅ Posted Week ${week} in <#${config.channelId}> — ${entries.length} games with lines.`
  );
}

async function handleGradeWeek(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const config = requireConfig(interaction, ctx);
  if (!config) {
    await respond(interaction, 'This server has not been set up. Run `/setup` first.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const week = interaction.options.getInteger('week', true);
  const live = await currentWeek(ctx.espn);

  // Refresh scores before grading so a manual re-grade uses current finals.
  await syncWeek(ctx.espn, ctx.repos, live.season, week);

  const participants = await participantIds(ctx.client, config);
  const summary = gradeWeek(ctx.repos, config.guildId, live.season, week, participants);

  await postRecap(ctx.client, ctx.repos, config, live.season, week);
  await postResultsAndStandings(ctx.client, ctx.repos, config, live.season, week);

  const warning = summary.ungradedGames > 0 ? ` (${summary.ungradedGames} game(s) not final yet)` : '';
  await respond(interaction, `✅ Graded Week ${week} for ${summary.records.length} players${warning}.`);
}

async function handleRefreshOdds(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const explicit = interaction.options.getInteger('week');
  const live = await currentWeek(ctx.espn);
  const week = explicit ?? live.week;

  ctx.espn.clearCache();
  const parsed = await syncWeek(ctx.espn, ctx.repos, live.season, week);

  await respond(
    interaction,
    `✅ Refreshed Week ${week}: ${parsed.games.length} games, ${parsed.lines.length} with lines.\n` +
      '_Existing lines were not overwritten — only the line watcher changes a line, and only on a significant move._'
  );
}

async function handleLineMoves(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been opened yet.');
    return;
  }

  const moves = ctx.repos.lineMoves.byWeek(target.season, target.week);
  if (moves.length === 0) {
    await respond(interaction, `No line movements recorded for Week ${target.week}.`);
    return;
  }

  const lines = moves.map((m) => {
    const game = ctx.repos.games.get(m.game_id);
    const matchup = game ? `${nickname(game.awayAbbr)} @ ${nickname(game.homeAbbr)}` : m.game_id;
    const when = new Date(m.detected_at).toISOString().slice(0, 16).replace('T', ' ');
    return `• **${matchup}** — O/U ${m.old_over_under}→${m.new_over_under}, spread ${m.old_spread}→${m.new_spread} _(${m.reasons})_ ${when}`;
  });

  await respond(interaction, [`**Line movements — Week ${target.week}**`, '', ...lines].join('\n'));
}

/**
 * Runs the line watch immediately rather than waiting for the nightly scan.
 * Useful right after setup, or when news breaks close to a kickoff.
 */
async function handleCheckLines(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const target = resolveWeek(interaction, ctx);
  if (!target) {
    await respond(interaction, 'No week has been opened yet.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const applied = await runLineWatch(ctx.client, ctx.repos, ctx.espn, target.season, target.week);

  await respond(
    interaction,
    applied > 0
      ? `✅ Applied ${applied} significant line move${applied === 1 ? '' : 's'} and alerted the affected players.`
      : `✅ Checked Week ${target.week} — no significant movement since the last check.`
  );
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
