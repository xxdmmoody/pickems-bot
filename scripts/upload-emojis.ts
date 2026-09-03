/**
 * One-time: uploads the 32 NFL team logos as application-owned emojis and
 * writes the abbreviation -> emoji-mention map the renderers read.
 *
 * Application emojis are usable in every server the app joins, need no
 * USE_EXTERNAL_EMOJIS permission, and consume none of a server's own emoji
 * slots — which is what makes one set of logos work across all three guilds.
 *
 * Safe to re-run: existing emojis are reused rather than duplicated.
 *
 *   npm run emojis:upload
 */
import { REST, Routes } from 'discord.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { TEAMS } from '../src/domain/teams.js';
import { logger } from '../src/logger.js';
import { emojiNameFor } from '../src/render/emoji.js';

interface ApplicationEmoji {
  id: string;
  name: string;
  animated?: boolean;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const appId = config.DISCORD_APPLICATION_ID;

  const existing = (await rest.get(Routes.applicationEmojis(appId))) as { items: ApplicationEmoji[] };
  const byName = new Map(existing.items.map((e) => [e.name, e]));
  logger.info({ existing: byName.size }, 'existing application emojis');

  const map: Record<string, string> = {};

  for (const team of TEAMS) {
    const name = emojiNameFor(team.abbr);
    const already = byName.get(name);

    if (already) {
      map[team.abbr] = `<:${name}:${already.id}>`;
      continue;
    }

    if (!team.logo) {
      logger.warn({ team: team.abbr }, 'no logo URL; skipping');
      continue;
    }

    const image = await fetchAsDataUri(team.logo);
    const created = (await rest.post(Routes.applicationEmojis(appId), {
      body: { name, image },
    })) as ApplicationEmoji;

    map[team.abbr] = `<:${name}:${created.id}>`;
    logger.info({ team: team.abbr, name, id: created.id }, 'uploaded emoji');

    // Emoji creation is rate limited; a small gap keeps a 32-item run smooth.
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  const outputPath = join(dirname(config.DATABASE_PATH), 'emoji-map.json');
  writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`);
  logger.info({ outputPath, count: Object.keys(map).length }, 'wrote emoji map');
}

/** Discord's emoji endpoint takes an image as a base64 data URI, not a URL. */
async function fetchAsDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);

  const contentType = response.headers.get('content-type') ?? 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.stack : String(error) }, 'emoji upload failed');
  process.exit(1);
});
