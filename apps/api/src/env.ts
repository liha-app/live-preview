import { LIMITS } from '@liha/shared';
import { parseTemplate } from './content-origin.js';
import type { Database, ObjectStore } from './ports.js';

export interface Env {
  DB: Database;
  BUCKET: ObjectStore;
  /** Origin of the web app, used to build share URLs. */
  APP_ORIGIN?: string;
  /**
   * Where this API answers, when that is not where the app is served from.
   * The review screen has to name it in its own Content-Security-Policy, and
   * it cannot infer it from a hostname that belongs to a preview.
   */
  API_ORIGIN?: string;
  /**
   * Where preview content is served from. `{label}` is replaced with
   * `<slug>--<versionNumber>`, giving every preview version its own origin so
   * uploaded HTML is isolated from the app by the browser's same-origin policy.
   * Example: `https://{label}.preview.example.com`
   *
   * When unset, content falls back to a path on this API origin — still
   * sandboxed, but without origin isolation. See docs/security.md.
   */
  CONTENT_ORIGIN_TEMPLATE?: string;
  /**
   * Where a preview's review screen lives, if each gets its own hostname.
   * `{slug}` is replaced. Example: `https://{slug}-lp.liha.review`.
   *
   * Sibling to the content hosts — one level under the same apex, so a single
   * wildcard certificate covers both — but a different origin, which is what
   * keeps uploaded HTML away from the owner token. When unset, share URLs stay
   * `APP_ORIGIN/p/<slug>` as before.
   */
  REVIEW_ORIGIN_TEMPLATE?: string;
  /** Static assets for the review screen, when the Worker serves it. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** HMAC key for short-lived content grants. */
  CONTENT_SIGNING_KEY?: string;
  /** Comma-separated list of extra origins allowed to call the API. */
  ALLOWED_ORIGINS?: string;
  MAX_VERSION_BYTES?: string;
  /**
   * Ceiling on everything this instance stores, across all previews. The
   * per-client rate limit slows an abuser down; this is what bounds the bill.
   * Set to `0` to remove the ceiling.
   */
  MAX_TOTAL_BYTES?: string;
  /**
   * Where notifications are set up, e.g. `https://notification.liha.review`.
   *
   * Notification permission is per origin and every preview has its own, so
   * asking on the review screen asks again for every preview anyone opens. One
   * origin asks once and its service worker covers all of them. Unset means the
   * deployment does not offer notifications.
   */
  NOTIFICATION_ORIGIN?: string;
  /** VAPID public key, base64url. Browsers subscribe with it. */
  VAPID_PUBLIC_KEY?: string;
  /** VAPID private key as a JWK. A secret. */
  VAPID_PRIVATE_KEY?: string;
  /** The VAPID `sub` claim. Defaults to the app origin, which RFC 8292 allows. */
  VAPID_SUBJECT?: string;
  /** Optional Cloudflare Browser Rendering binding used for URL screenshots. */
  BROWSER?: unknown;
}

export interface ResolvedConfig {
  appOrigin: string;
  apiOrigin: string;
  contentOriginTemplate: string | null;
  reviewOriginTemplate: string | null;
  contentSigningKey: string;
  notificationOrigin: string | null;
  allowedOrigins: string[];
  maxVersionBytes: number;
  /** Null when the deployment has opted out of a global ceiling. */
  maxTotalBytes: number | null;
}

const DEV_SIGNING_KEY = 'liha-development-signing-key-do-not-use-in-production';

/**
 * The throwaway VAPID key committed in wrangler.toml so local development has a
 * working notification flow. Deploying it would mean anyone could send push to
 * this deployment's subscribers, so it is named here in order to be refused.
 */
const DEV_VAPID_PUBLIC_KEY =
  'BGEpyIoPOQ31k9pUsOlL3sctXBT6DS46M5EeqBnauw1idMhVxtz7D9mx2WPhtqO5iHY8BH3P0N8XE3CBEFBaE7E';

/** `0` means "no ceiling"; anything unparseable falls back to the default. */
function parseCeiling(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed === 0 ? null : parsed;
}

export function resolveConfig(env: Env, requestUrl: URL): ResolvedConfig {
  const appOrigin = env.APP_ORIGIN?.replace(/\/$/, '') ?? 'http://localhost:5173';
  const extra = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    appOrigin,
    // Same origin as the app unless said otherwise, which is the shape of a
    // deployment that serves both from one place.
    apiOrigin: env.API_ORIGIN?.replace(/\/$/, '') ?? appOrigin,
    contentOriginTemplate: env.CONTENT_ORIGIN_TEMPLATE?.replace(/\/$/, '') ?? null,
    reviewOriginTemplate: env.REVIEW_ORIGIN_TEMPLATE?.replace(/\/$/, '') ?? null,
    contentSigningKey: env.CONTENT_SIGNING_KEY ?? DEV_SIGNING_KEY,
    notificationOrigin: env.NOTIFICATION_ORIGIN?.replace(/\/$/, '') ?? null,
    // The notification origin calls this API to subscribe and to ask what a
    // service worker missed, so it has to be allowed by name — it is not a
    // review host and the template will not recognise it.
    allowedOrigins: [
      appOrigin,
      requestUrl.origin,
      ...(env.NOTIFICATION_ORIGIN ? [env.NOTIFICATION_ORIGIN.replace(/\/$/, '')] : []),
      ...extra,
    ],
    maxVersionBytes: Number.parseInt(env.MAX_VERSION_BYTES ?? '', 10) || LIMITS.maxVersionBytes,
    maxTotalBytes: parseCeiling(env.MAX_TOTAL_BYTES) ?? LIMITS.maxTotalBytes,
  };
}

/** Refuses to start with the built-in development signing key outside local dev. */
export function assertProductionConfig(env: Env): string[] {
  const warnings: string[] = [];
  if (!env.CONTENT_SIGNING_KEY) warnings.push('CONTENT_SIGNING_KEY is not set.');
  if (env.VAPID_PUBLIC_KEY === DEV_VAPID_PUBLIC_KEY) {
    warnings.push(
      'VAPID_PUBLIC_KEY is the development keypair committed to this repository. ' +
        'Its private half is public, so anyone could send notifications to this ' +
        "deployment's subscribers. Run scripts/deploy.mjs, which generates a real pair.",
    );
  }
  if (!env.APP_ORIGIN) warnings.push('APP_ORIGIN is not set.');
  if (!env.CONTENT_ORIGIN_TEMPLATE) {
    warnings.push('CONTENT_ORIGIN_TEMPLATE is not set; preview content is not origin-isolated.');
  } else if (!parseTemplate(env.CONTENT_ORIGIN_TEMPLATE)) {
    // Silence here would be the worst outcome: content quietly falls back to a
    // path on the API origin, and the deployment looks fine until someone
    // checks whether uploads are actually isolated.
    warnings.push(
      `CONTENT_ORIGIN_TEMPLATE ("${env.CONTENT_ORIGIN_TEMPLATE}") is unusable: it must put ` +
        '{label} in the hostname, as in https://{label}.example.net. Preview content has ' +
        'fallen back to a path on the API origin and is NOT origin-isolated.',
    );
  }
  return warnings;
}
