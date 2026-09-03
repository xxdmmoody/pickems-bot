/** Shared number and text formatting for every message the bot posts. */

/** 46.5 -> "46.5", 46 -> "46" — lines are quoted in halves, never as "46.0". */
export function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** -7.5 -> "-7.5", 7.5 -> "+7.5" — always carries an explicit sign. */
export function signed(value: number): string {
  const body = num(Math.abs(value));
  return value < 0 ? `-${body}` : `+${body}`;
}

/**
 * The spread as a sportsbook writes it next to the favorite: always negative,
 * e.g. "-7.5". `spread` is home-relative, so its magnitude is what matters.
 */
export function favoriteNumber(spread: number): string {
  return `-${num(Math.abs(spread))}`;
}

/** The underdog's side of the same number, e.g. "+7.5". */
export function underdogNumber(spread: number): string {
  return `+${num(Math.abs(spread))}`;
}

export function bold(text: string): string {
  return `**${text}**`;
}

/** Discord user mention. */
export function mention(userId: string): string {
  return `<@${userId}>`;
}

export function roleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

/**
 * Joins lines and hard-caps the result below Discord's 2000-character message
 * limit, trimming whole lines so a message never fails to send.
 */
export function joinLines(lines: readonly string[], limit = 1950): string {
  const out: string[] = [];
  let length = 0;

  for (const line of lines) {
    const cost = line.length + 1;
    if (length + cost > limit) {
      out.push('…');
      break;
    }
    out.push(line);
    length += cost;
  }

  return out.join('\n');
}
