import 'dotenv/config';
import { z } from 'zod';

/**
 * The Discord developer portal shows four different credentials, and only two of
 * them belong in this file. Pasting the wrong one otherwise surfaces as an
 * opaque "401 Unauthorized" from the gateway, so the obviously-wrong shapes are
 * named here instead.
 *
 *   Bot token      Bot tab -> Reset Token. Three dot-separated segments.
 *   Application ID General Information. A 17-20 digit snowflake.
 *   Public Key     64 hex characters. For HTTP interaction endpoints — this bot
 *                  uses the gateway, so it is never needed.
 *   Client Secret  32 characters. OAuth2 only, also never needed.
 */
const PUBLIC_KEY_SHAPE = /^[0-9a-fA-F]{64}$/;
const SNOWFLAKE_SHAPE = /^\d{17,20}$/;

const tokenField = z
  .string()
  .min(1, 'DISCORD_TOKEN is required — Discord developer portal, Bot tab, "Reset Token"')
  .refine((value) => !PUBLIC_KEY_SHAPE.test(value), {
    message:
      'this is the application PUBLIC KEY (64 hex characters), not the bot token. ' +
      'The token is under the Bot tab in the left sidebar — press "Reset Token". ' +
      'The Public Key is only used for HTTP interaction endpoints, which this bot does not use',
  })
  .refine((value) => !SNOWFLAKE_SHAPE.test(value), {
    message: 'this is the APPLICATION ID, not the bot token. The token is under the Bot tab',
  })
  .refine((value) => !value.toLowerCase().startsWith('bot '), {
    message: 'drop the "Bot " prefix — discord.js adds it itself',
  });

const applicationIdField = z
  .string()
  .min(1, 'DISCORD_APPLICATION_ID is required — Discord developer portal, General Information')
  .refine((value) => !value.includes('.'), {
    message: 'this looks like the BOT TOKEN. The application ID is the numeric ID on General Information',
  })
  .refine((value) => SNOWFLAKE_SHAPE.test(value), {
    message: 'should be a 17-20 digit numeric ID, copied from General Information',
  });

const schema = z.object({
  DISCORD_TOKEN: tokenField,
  DISCORD_APPLICATION_ID: applicationIdField,
  DATABASE_PATH: z.string().default('./data/pickems.db'),
  DEFAULT_TIMEZONE: z.string().default('America/Chicago'),
  /** Registers commands to one guild instead of globally — instant, for dev. */
  DEV_GUILD_ID: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

/**
 * Reads and validates configuration. Fails loudly at startup rather than at the
 * first Discord call, so a missing token is obvious in the service log.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
