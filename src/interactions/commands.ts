import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import type { Repos } from '../db/repos.js';
import { TEAMS, nickname } from '../domain/teams.js';
import type { EspnClient } from '../espn/client.js';
import { logger } from '../logger.js';
import { renderResults, renderStandings } from '../render/results.js';
import { renderSchedule } from '../render/schedule.js';
import { gradeWeek } from '../services/grade.js';
import { participantIds } from '../services/participants.js';
import { describeSlate, findIncomplete } from '../services/picks.js';
import { postWeek, postResultsAndStandings, postRecap } from '../services/poster.js';
import { byeTeams, currentWeek, loadWeek, syncWeek, FIRST_WEEK, LAST_WEEK } from '../services/week.js';

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
    .setDescription('Configure the channel and participant role for this server')
    .setDefaultMemberPermissions(adminOnly)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel the bot posts picks and results in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName('role').setDescription('Role held by everyone playing').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('timezone').setDescription('IANA timezone, e.g. America/Chicago').setRequired(false)
    ),

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

async function handleSetup(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const role = interaction.options.getRole('role', true);
  const timezone = interaction.options.getString('timezone') ?? ctx.defaultTimezone;

  if (!isValidTimezone(timezone)) {
    await respond(interaction, `❌ \`${timezone}\` is not a valid IANA timezone.`);
    return;
  }

  ctx.repos.guilds.upsert({
    guildId: interaction.guildId!,
    channelId: channel.id,
    roleId: role.id,
    timezone,
  });

  await respond(
    interaction,
    `✅ Set up. Picks will post in <#${channel.id}>, tagging <@&${role.id}>, on ${timezone} time.\n` +
      'Run `/openweek` when you are ready to post the first week.'
  );
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

  const explicit = interaction.options.getInteger('week');
  const live = await currentWeek(ctx.espn);
  const season = live.season;
  const week = explicit ?? live.week;

  await syncWeek(ctx.espn, ctx.repos, season, week);
  await postWeek(ctx.client, ctx.repos, config, season, week);

  await respond(interaction, `✅ Posted Week ${week} picks in <#${config.channelId}>.`);
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

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
