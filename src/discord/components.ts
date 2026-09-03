import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import type { Category, GameWithLine } from '../domain/types.js';
import { teamEmoji } from '../render/emoji.js';
import { buildOptions } from '../render/picks.js';

/**
 * Pick interactions are routed by `customId` through a single global
 * `interactionCreate` handler rather than a per-message collector. Collectors
 * live and die with the process; the posted messages do not. Encoding the week
 * into the id means a dropdown still works after a restart, a redeploy, or a
 * week rollover, and a stale message from a previous week is recognised and
 * rejected rather than silently writing to the wrong week.
 */
export const PICK_PREFIX = 'pick';

export function pickCustomId(category: Category, season: number, week: number): string {
  return `${PICK_PREFIX}:${category}:${season}:${week}`;
}

export interface ParsedPickId {
  category: Category;
  season: number;
  week: number;
}

export function parsePickCustomId(customId: string): ParsedPickId | null {
  const parts = customId.split(':');
  if (parts.length !== 4 || parts[0] !== PICK_PREFIX) return null;

  const [, category, season, week] = parts;
  const seasonNum = Number(season);
  const weekNum = Number(week);
  if (!category || !Number.isInteger(seasonNum) || !Number.isInteger(weekNum)) return null;

  return { category: category as Category, season: seasonNum, week: weekNum };
}

/**
 * Builds the dropdown for one pick category.
 *
 * Returns null when nothing is selectable — every game has kicked off, or the
 * week is all pick'ems for a spread category. Discord rejects a select menu with
 * zero options, so the caller posts the message without components instead.
 */
export function buildPickRow(
  category: Category,
  entries: readonly GameWithLine[],
  season: number,
  week: number
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const options = buildOptions(category, entries);
  if (options.length === 0) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(pickCustomId(category, season, week))
    .setPlaceholder(placeholderFor(category))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      options.map((option) => {
        const builder = new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setValue(option.value);

        if (option.description) builder.setDescription(option.description);

        // Select options carry exactly one emoji. `teamEmoji` returns the
        // `<:name:id>` form, which Discord's builder parses.
        const emoji = teamEmoji(option.emojiAbbr);
        if (emoji) builder.setEmoji(emoji);

        return builder;
      })
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function placeholderFor(category: Category): string {
  switch (category) {
    case 'OVER':
      return 'Pick a game to hit the OVER';
    case 'UNDER':
      return 'Pick a game to hit the UNDER';
    case 'FAVORITE':
      return 'Pick a favorite to cover';
    case 'UNDERDOG':
      return 'Pick an underdog to cover';
  }
}
