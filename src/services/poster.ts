import type { ActionRowBuilder, Client, StringSelectMenuBuilder, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { pickMessageKind, type GuildConfig, type MessageKind, type Repos } from '../db/repos.js';
import { isGameLocked } from '../domain/lock.js';
import { TEAMS } from '../domain/teams.js';
import { CATEGORIES, type Category, type GameWithLine } from '../domain/types.js';
import { buildPickRow } from '../discord/components.js';
import { logger } from '../logger.js';
import { renderPickMessage } from '../render/picks.js';
import { renderRecap } from '../render/recap.js';
import { renderResults, renderStandings } from '../render/results.js';
import { renderSchedule } from '../render/schedule.js';
import { roleMention } from '../render/format.js';
import { byeTeams, loadWeek } from './week.js';

/** Resolves a guild's configured channel, or null if it is gone or unusable. */
export async function resolveChannel(client: Client, config: GuildConfig): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      logger.error({ guildId: config.guildId, channelId: config.channelId }, 'configured channel is not a text channel');
      return null;
    }
    return channel;
  } catch (error) {
    logger.error({ guildId: config.guildId, err: String(error) }, 'could not fetch configured channel');
    return null;
  }
}

async function post(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number,
  kind: MessageKind,
  content: string,
  components: ActionRowBuilder<StringSelectMenuBuilder>[] = []
): Promise<void> {
  const channel = await resolveChannel(client, config);
  if (!channel) return;

  const message = await channel.send({ content, components });
  repos.messages.save({
    guildId: config.guildId,
    season,
    week,
    kind,
    channelId: channel.id,
    messageId: message.id,
  });
}

/** Posts last week's results and the running standings. */
export async function postResultsAndStandings(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number
): Promise<void> {
  const weekly = repos.results.forWeek(config.guildId, season, week);
  await post(client, repos, config, season, week, 'RESULTS', renderResults(week, weekly));

  const totals = repos.results.season(config.guildId, season);
  await post(client, repos, config, season, week, 'STANDINGS', renderStandings(season, totals));
}

/** Posts the recap of a completed week. */
export async function postRecap(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number
): Promise<void> {
  const entries = loadWeek(repos, season, week);
  const byes = byeTeams(repos, season, week, TEAMS.map((t) => t.abbr));
  await post(client, repos, config, season, week, 'RECAP', renderRecap(season, week, entries, byes));
}

/**
 * Posts the new week: the schedule, then the four pick messages with the
 * participant role tagged on the first of them.
 */
export async function postWeek(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number,
  now = Date.now()
): Promise<void> {
  const entries = loadWeek(repos, season, week);
  if (entries.length === 0) {
    logger.warn({ season, week }, 'no games with lines to post');
    return;
  }

  const byes = byeTeams(repos, season, week, TEAMS.map((t) => t.abbr));
  await post(
    client,
    repos,
    config,
    season,
    week,
    'SCHEDULE',
    renderSchedule(season, week, entries, byes)
  );

  const open = entries.filter((e) => !isGameLocked(e.game, now));

  for (const [index, category] of CATEGORIES.entries()) {
    const body = renderPickMessage(category, open);
    // Tag the role once, on the first pick message, rather than four times.
    const content = index === 0 ? `${roleMention(config.roleId)} picks are ready!\n\n${body}` : body;
    const row = buildPickRow(category, open, season, week);

    await post(
      client,
      repos,
      config,
      season,
      week,
      pickMessageKind(category),
      content,
      row ? [row] : []
    );
  }
}

/**
 * Rewrites the four pick messages against the current set of open games.
 *
 * Called when a game kicks off (dropping newly locked options) and after a line
 * move (so the numbers shown match what will grade). Editing keeps the original
 * message, so nobody has to scroll to find the current dropdown.
 */
export async function refreshPickMessages(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number,
  now = Date.now()
): Promise<void> {
  const entries = loadWeek(repos, season, week);
  const open = entries.filter((e) => !isGameLocked(e.game, now));

  for (const category of CATEGORIES) {
    await refreshOne(client, repos, config, season, week, category, open);
  }
}

async function refreshOne(
  client: Client,
  repos: Repos,
  config: GuildConfig,
  season: number,
  week: number,
  category: Category,
  open: readonly GameWithLine[]
): Promise<void> {
  const stored = repos.messages.get(config.guildId, season, week, pickMessageKind(category));
  if (!stored) return;

  try {
    const channel = await client.channels.fetch(stored.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const message = await channel.messages.fetch(stored.messageId);
    const row = buildPickRow(category, open, season, week);
    const body = renderPickMessage(category, open);

    // Preserve the role mention that leads the first pick message.
    const existing = message.content;
    const prefix = existing.startsWith('<@&') ? `${existing.split('\n\n')[0]}\n\n` : '';

    await message.edit({ content: `${prefix}${body}`, components: row ? [row] : [] });
  } catch (error) {
    logger.warn(
      { guildId: config.guildId, category, err: String(error) },
      'could not refresh pick message'
    );
  }
}

/** Posts a one-off message (a nudge or a line-movement alert) to the guild channel. */
export async function announce(
  client: Client,
  config: GuildConfig,
  content: string
): Promise<void> {
  const channel = await resolveChannel(client, config);
  if (!channel) return;
  await channel.send({ content });
}
