/**
 * How long an expiring preview has left, in a form a person reads at a glance.
 *
 * Only samples expire. Saying so on the screen matters because a sample is a
 * real preview that the visitor owns — they can upload to it, share it, get
 * comments on it — and nothing else about it says it is temporary. Finding out
 * by returning to a 404 is the worst way to learn.
 */
export function timeLeft(expiresAt: string | null): { hours: number; minutes: number } | null {
  if (!expiresAt) return null;

  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;

  return {
    hours: Math.floor(remaining / 3_600_000),
    minutes: Math.max(1, Math.round(remaining / 60_000)),
  };
}
