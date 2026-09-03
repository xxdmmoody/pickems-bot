import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import type { Repos } from '../db/repos.js';
import { parsePickCustomId } from '../discord/components.js';
import { logger } from '../logger.js';
import { parseOptionValue } from '../render/picks.js';
import { describeSlate, submitPick } from '../services/picks.js';

/**
 * Handles a pick dropdown selection.
 *
 * Every reply is ephemeral: confirmations and errors are for the picker alone,
 * so the channel stays readable and nobody's picks leak.
 */
export async function handlePickSelect(
  interaction: StringSelectMenuInteraction,
  repos: Repos,
  defaultTimezone: string
): Promise<void> {
  const parsed = parsePickCustomId(interaction.customId);
  if (!parsed) return;

  if (!interaction.guildId) {
    await reply(interaction, 'Picks can only be made in a server.');
    return;
  }

  const config = repos.guilds.get(interaction.guildId);
  if (!config) {
    await reply(interaction, 'This server has not been set up yet. An admin needs to run `/setup`.');
    return;
  }

  const selected = interaction.values[0];
  if (!selected) {
    await reply(interaction, 'No selection received — try again.');
    return;
  }

  const { gameId, teamAbbr } = parseOptionValue(selected);

  const result = submitPick(repos, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    season: parsed.season,
    week: parsed.week,
    category: parsed.category,
    gameId,
    teamAbbr,
    timezone: config.timezone || defaultTimezone,
  });

  if (!result.ok) {
    await reply(interaction, `❌ ${result.reason}`);
    return;
  }

  logger.info(
    {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      week: parsed.week,
      category: parsed.category,
      gameId,
      teamAbbr,
    },
    'pick saved'
  );

  const lines = [`✅ Your **${parsed.category}** pick is saved.`];

  if (result.complete) {
    lines.push('', `🏈 **All four picks are in for Week ${parsed.week}:**`, ...describeSlate(repos, result.slate));
  } else {
    const remaining = 4 - result.slate.length;
    lines.push('', `_${remaining} pick${remaining === 1 ? '' : 's'} still to make._`);
  }

  await reply(interaction, lines.join('\n'));
}

async function reply(interaction: StringSelectMenuInteraction, content: string): Promise<void> {
  try {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.warn({ err: String(error) }, 'could not reply to pick interaction');
  }
}
