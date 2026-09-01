/**
 * A fresh client identity per created preview.
 *
 * The API rate-limits new previews per client, and a suite that creates dozens
 * of them in seconds is standing in for many users, not one. In production
 * Cloudflare sets `cf-connecting-ip`, so a test is the only place the caller
 * ever writes it.
 */
let counter = 0;

export const asNewClient = (): Record<string, string> => ({
  'cf-connecting-ip': `203.0.113.${(counter += 1) % 250}`,
});
