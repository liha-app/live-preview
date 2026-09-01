import { LIMITS } from '@liha/shared';
import { parseTemplate } from './content-origin.js';
import type { Database, ObjectStore } from './ports.js';

export interface Env {
  DB: Database;
  BUCKET: ObjectStore;
  /** Origin of the web app, used to build share URLs. */
  APP_ORIGIN?: string;
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
  /** Optional Cloudflare Browser Rendering binding used for URL screenshots. */
  BROWSER?: unknown;
}

export interface ResolvedConfig {
  appOrigin: string;
  contentOriginTemplate: string | null;
  contentSigningKey: string;
  allowedOrigins: string[];
  maxVersionBytes: number;
  /** Null when the deployment has opted out of a global ceiling. */
  maxTotalBytes: number | null;
}

const DEV_SIGNING_KEY = 'liha-development-signing-key-do-not-use-in-production';

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
    contentOriginTemplate: env.CONTENT_ORIGIN_TEMPLATE?.replace(/\/$/, '') ?? null,
    contentSigningKey: env.CONTENT_SIGNING_KEY ?? DEV_SIGNING_KEY,
    allowedOrigins: [appOrigin, requestUrl.origin, ...extra],
    maxVersionBytes: Number.parseInt(env.MAX_VERSION_BYTES ?? '', 10) || LIMITS.maxVersionBytes,
    maxTotalBytes: parseCeiling(env.MAX_TOTAL_BYTES) ?? LIMITS.maxTotalBytes,
  };
}

/** Refuses to start with the built-in development signing key outside local dev. */
export function assertProductionConfig(env: Env): string[] {
  const warnings: string[] = [];
  if (!env.CONTENT_SIGNING_KEY) warnings.push('CONTENT_SIGNING_KEY is not set.');
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
