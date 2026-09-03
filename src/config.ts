import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_APPLICATION_ID: z.string().min(1, 'DISCORD_APPLICATION_ID is required'),
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
