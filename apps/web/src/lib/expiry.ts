/**
 * How long a preview has left, in a form a person reads at a glance.
 *
 * Everything expires now, counted from when it was last used — so this is
 * usually a long way off and quietly reassuring rather than a warning. It has
 * to be on the screen because nothing else about a preview says it is
 * temporary, and finding out by returning to a 404 is the worst way to learn.
 */
export function timeLeft(
  expiresAt: string | null,
): { days: number; hours: number; minutes: number } | null {
  if (!expiresAt) return null;

  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;

  return {
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor(remaining / 3_600_000),
    minutes: Math.max(1, Math.round(remaining / 60_000)),
  };
}
