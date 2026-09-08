import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

// None of these are real credentials.
//
// The token placeholder is deliberately NOT written to look like a real one.
// A realistic-looking value here matches GitHub's Discord bot token pattern and
// gets the whole push blocked by secret scanning — correctly, since scanning
// cannot tell a convincing fake from the real thing. The validator only cares
// that a token has dot-separated segments and is not one of the other
// credentials, so a plainly fake value exercises it just as well.
const VALID_TOKEN = 'EXAMPLE-BOT-ID.EXAMPLE-TIMESTAMP.EXAMPLE-SIGNATURE';
const VALID_APP_ID = '123456789012345678';
const PUBLIC_KEY = 'a'.repeat(64);

const base = { DISCORD_TOKEN: VALID_TOKEN, DISCORD_APPLICATION_ID: VALID_APP_ID };

describe('loadConfig', () => {
  it('accepts a well-formed token and application ID', () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    expect(config.DISCORD_TOKEN).toBe(VALID_TOKEN);
    expect(config.DEFAULT_TIMEZONE).toBe('America/Chicago');
    expect(config.DATABASE_PATH).toBe('./data/pickems.db');
  });

  it('names the public key when it is pasted as the token', () => {
    // The single most common setup mistake: the Public Key sits on the General
    // Information page right next to the Application ID, so it gets grabbed by
    // mistake. Without this the failure is an opaque 401 from the gateway.
    expect(() =>
      loadConfig({ ...base, DISCORD_TOKEN: PUBLIC_KEY } as NodeJS.ProcessEnv)
    ).toThrow(/PUBLIC KEY/);
  });

  it('points at the Bot tab when the application ID is pasted as the token', () => {
    expect(() =>
      loadConfig({ ...base, DISCORD_TOKEN: VALID_APP_ID } as NodeJS.ProcessEnv)
    ).toThrow(/APPLICATION ID, not the bot token/);
  });

  it('rejects a "Bot " prefix, which discord.js adds itself', () => {
    expect(() =>
      loadConfig({ ...base, DISCORD_TOKEN: `Bot ${VALID_TOKEN}` } as NodeJS.ProcessEnv)
    ).toThrow(/drop the "Bot " prefix/);
  });

  it('catches the token pasted into the application ID', () => {
    expect(() =>
      loadConfig({ ...base, DISCORD_APPLICATION_ID: VALID_TOKEN } as NodeJS.ProcessEnv)
    ).toThrow(/BOT TOKEN/);
  });

  it('rejects a non-numeric application ID', () => {
    expect(() =>
      loadConfig({ ...base, DISCORD_APPLICATION_ID: 'my-app' } as NodeJS.ProcessEnv)
    ).toThrow(/17-20 digit/);
  });

  it('reports an empty token with where to find it', () => {
    expect(() => loadConfig({ ...base, DISCORD_TOKEN: '' } as NodeJS.ProcessEnv)).toThrow(/Bot tab/);
  });

  it('lists every problem at once rather than one per run', () => {
    let message = '';
    try {
      loadConfig({ DISCORD_TOKEN: PUBLIC_KEY, DISCORD_APPLICATION_ID: 'nope' } as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('DISCORD_TOKEN');
    expect(message).toContain('DISCORD_APPLICATION_ID');
  });
});
