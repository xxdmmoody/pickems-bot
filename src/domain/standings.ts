import type { WeekRecord } from './types.js';

export interface SeasonRecord {
  readonly userId: string;
  readonly wins: number;
  readonly losses: number;
  readonly pushes: number;
}

export interface RankedRecord extends SeasonRecord {
  /** 1-based; players with identical records share a rank. */
  readonly rank: number;
}

/** Sums a season's weekly records per player. */
export function accumulate(weekly: readonly WeekRecord[]): SeasonRecord[] {
  const totals = new Map<string, { wins: number; losses: number; pushes: number }>();
  for (const w of weekly) {
    const t = totals.get(w.userId) ?? { wins: 0, losses: 0, pushes: 0 };
    t.wins += w.wins;
    t.losses += w.losses;
    t.pushes += w.pushes;
    totals.set(w.userId, t);
  }
  return [...totals].map(([userId, t]) => ({ userId, ...t }));
}

/**
 * Orders standings best to worst: most wins, then fewest losses, then user id
 * as a stable final tiebreak. Ties share a rank, so two players on 15-4 are both
 * 1st and the next player is 3rd.
 */
export function rank(records: readonly SeasonRecord[]): RankedRecord[] {
  const sorted = [...records].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || a.userId.localeCompare(b.userId)
  );

  const ranked: RankedRecord[] = [];
  let currentRank = 0;
  let previous: SeasonRecord | null = null;

  sorted.forEach((r, index) => {
    const tiedWithPrevious = previous !== null && r.wins === previous.wins && r.losses === previous.losses;
    if (!tiedWithPrevious) currentRank = index + 1;
    ranked.push({ ...r, rank: currentRank });
    previous = r;
  });

  return ranked;
}

/** Groups a week's records by their W-L line, best first — the results message. */
export function groupByRecord(weekly: readonly WeekRecord[]): {
  wins: number;
  losses: number;
  pushes: number;
  userIds: string[];
}[] {
  const groups = new Map<string, { wins: number; losses: number; pushes: number; userIds: string[] }>();

  for (const w of weekly) {
    const key = `${w.wins}-${w.losses}-${w.pushes}`;
    const g = groups.get(key) ?? { wins: w.wins, losses: w.losses, pushes: w.pushes, userIds: [] };
    g.userIds.push(w.userId);
    groups.set(key, g);
  }

  return [...groups.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}
