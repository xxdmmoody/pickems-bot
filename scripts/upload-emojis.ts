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
import { mkdirSync, writeFileSync } from 'node:fs';
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
  let reused = 0;
  let uploaded = 0;
  const failed: string[] = [];

  for (const team of TEAMS) {
    const name = emojiNameFor(team.abbr);
    const already = byName.get(name);

    if (already) {
      map[team.abbr] = `<:${name}:${already.id}>`;
      reused += 1;
      continue;
    }

    if (!team.logo) {
      logger.warn({ team: team.abbr }, 'no logo URL; skipping');
      continue;
    }

    // One team failing — a rate limit, a bad response from the CDN — should not
    // discard the other 31 uploads. Record it and carry on; re-running picks up
    // where this left off, because uploads already done are reused above.
    try {
      const image = await fetchAsDataUri(team.logo);
      const created = (await rest.post(Routes.applicationEmojis(appId), {
        body: { name, image },
      })) as ApplicationEmoji;

      map[team.abbr] = `<:${name}:${created.id}>`;
      uploaded += 1;
      logger.info({ team: team.abbr, name, id: created.id }, 'uploaded emoji');
    } catch (error) {
      failed.push(team.abbr);
      logger.error({ team: team.abbr, err: describe(error) }, 'emoji upload failed for team');
    }

    // Emoji creation is rate limited; a small gap keeps a 32-item run smooth.
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  const outputPath = join(dirname(config.DATABASE_PATH), 'emoji-map.json');

  // The bot creates this directory when it opens the database, but this script
  // never touches the database — so on a fresh clone it does not exist yet, and
  // writing here would fail after every emoji had already been uploaded.
  mkdirSync(dirname(outputPath), { recursive: true });

  writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`);
  logger.info({ outputPath, mapped: Object.keys(map).length, uploaded, reused }, 'wrote emoji map');

  if (failed.length > 0) {
    logger.warn(
      { failed },
      'some teams did not upload; re-run this script to retry just those'
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
