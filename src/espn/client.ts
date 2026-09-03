import { logger } from '../logger.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

/** ESPN season types. Only the regular season is in scope. */
export const REGULAR_SEASON = 2;

export interface EspnClientOptions {
  /** How long a successful response stays cached. Defaults to 5 minutes. */
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  body: unknown;
}

/**
 * Minimal client for ESPN's public (undocumented) NFL API.
 *
 * Deliberately sends no extra request headers. ESPN sits behind bot protection
 * that has been observed rejecting requests carrying browser-like `Origin` and
 * `Referer` headers with a 403, while plain requests succeed. There is nothing
 * to gain from dressing these calls up as a browser, so we don't.
 *
 * The API is undocumented and can change without notice, so every response goes
 * through zod validation in mapper.ts rather than being trusted structurally.
 */
export class EspnClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: EspnClientOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Raw scoreboard payload for one week. */
  async scoreboard(season: number, week: number): Promise<unknown> {
    const url = `${BASE}/scoreboard?dates=${season}&seasontype=${REGULAR_SEASON}&week=${week}`;
    return this.getJson(url);
  }

  /** Raw scoreboard for whatever ESPN considers the current week. */
  async currentScoreboard(): Promise<unknown> {
    return this.getJson(`${BASE}/scoreboard`);
  }

  /** Raw team list — used once to seed emoji uploads and the static team table. */
  async teams(): Promise<unknown> {
    return this.getJson(`${BASE}/teams?limit=40`);
  }

  /** Drops cached responses so a manual refresh command really refetches. */
  clearCache(): void {
    this.cache.clear();
  }

  private async getJson(url: string): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) {
      return cached.body;
    }

    const body = await this.fetchWithRetry(url);
    this.cache.set(url, { expiresAt: this.now() + this.cacheTtlMs, body });
    return body;
  }

  private async fetchWithRetry(url: string): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // 500ms, 1s, 2s — enough to ride out a blip without stalling a job.
        await delay(500 * 2 ** (attempt - 1));
      }

      try {
        const response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          // 4xx other than 429 will not fix themselves; fail fast.
          if (response.status < 500 && response.status !== 429) {
            throw new EspnError(`ESPN returned ${response.status} for ${url}`, response.status);
          }
          throw new EspnError(`ESPN returned ${response.status}`, response.status);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        if (error instanceof EspnError && error.status < 500 && error.status !== 429) {
          throw error;
        }
        logger.warn(
          { url, attempt, err: error instanceof Error ? error.message : String(error) },
          'ESPN request failed, retrying'
        );
      }
    }

    throw new EspnError(
      `ESPN request failed after ${this.maxRetries + 1} attempts: ${url} (${String(lastError)})`,
      0
    );
  }
}

export class EspnError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'EspnError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
