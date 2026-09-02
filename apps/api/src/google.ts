import { base64UrlToBytes, bytesToBase64Url, randomString, utf8 } from '@liha/shared';
import { createContentToken, verifyContentToken } from '@liha/shared';
import type { ResolvedConfig } from './env.js';

/**
 * Signing in with Google.
 *
 * Optional, and never a gate: everything works without it. What it buys is that
 * the anonymous account a browser already has stops being tied to that browser
 * — the same previews and the same activity show up on the phone.
 *
 * Standard authorization code flow with PKCE. The verifier cannot live in the
 * `state` parameter, which travels through Google in a URL, so it lives in a
 * short-lived cookie instead — which also gives the state something to be
 * compared against, and that is the CSRF defence the flow requires.
 */

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const OAUTH_COOKIE = 'liha_oauth';
const OAUTH_LIFETIME_MS = 10 * 60 * 1000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

export function redirectUri(config: ResolvedConfig): string {
  return `${config.apiOrigin}/api/auth/google/callback`;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value) as BufferSource));
}

export interface PendingSignIn {
  state: string;
  verifier: string;
  returnTo: string;
}

/**
 * Where to come back to.
 *
 * Only somewhere this deployment serves. A return URL is attacker-supplied
 * until proven otherwise, and an open redirect on a sign-in endpoint is how a
 * phishing page borrows somebody else's domain.
 */
export function safeReturn(value: string | null, config: ResolvedConfig): string {
  if (!value) return config.appOrigin;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return config.appOrigin;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return config.appOrigin;

  const allowed = [config.appOrigin, config.apiOrigin, config.notificationOrigin]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => new URL(origin).hostname);
  const shared = config.reviewOriginTemplate
    ? new URL(config.reviewOriginTemplate.replace('{slug}', 'x')).hostname
        .split('.')
        .slice(-2)
        .join('.')
    : null;

  if (allowed.includes(url.hostname)) return url.href;
  if (shared && (url.hostname === shared || url.hostname.endsWith(`.${shared}`))) return url.href;
  return config.appOrigin;
}

/** Builds the URL to send someone to, and the cookie that remembers why. */
export async function startSignIn(
  google: GoogleConfig,
  config: ResolvedConfig,
  returnTo: string,
): Promise<{ authorizeUrl: string; cookie: string }> {
  const verifier = randomString(64);
  const state = randomString(32);
  const challenge = bytesToBase64Url(await sha256(verifier));

  const pending = await createContentToken(config.contentSigningKey, {
    previewId: `${state}:${verifier}`,
    versionId: returnTo,
    exp: Date.now() + OAUTH_LIFETIME_MS,
  });

  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', google.clientId);
  url.searchParams.set('redirect_uri', redirectUri(config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Ask afresh rather than reusing whatever session the browser has, so
  // "sign in" means what it says on a shared machine.
  url.searchParams.set('prompt', 'select_account');

  const secure = config.apiOrigin.startsWith('https://')
    ? '; SameSite=Lax; Secure'
    : '; SameSite=Lax';
  return {
    authorizeUrl: url.href,
    cookie: `${OAUTH_COOKIE}=${pending}; Path=/api/auth; Max-Age=${OAUTH_LIFETIME_MS / 1000}; HttpOnly${secure}`,
  };
}

export async function readPending(
  config: ResolvedConfig,
  cookieValue: string | null,
): Promise<PendingSignIn | null> {
  if (!cookieValue) return null;
  const grant = await verifyContentToken(config.contentSigningKey, cookieValue);
  if (!grant) return null;

  const separator = grant.previewId.indexOf(':');
  if (separator <= 0) return null;
  return {
    state: grant.previewId.slice(0, separator),
    verifier: grant.previewId.slice(separator + 1),
    returnTo: grant.versionId,
  };
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
}

/**
 * Exchanges the code for an identity.
 *
 * The id_token's signature is not checked here, and deliberately: it came
 * straight from Google's token endpoint over TLS, which is the one case
 * Google's own documentation says needs no verification. `iss` and `aud` are
 * still checked, because a token for somebody else's client is not ours to
 * accept however it arrived.
 */
export async function exchangeCode(
  google: GoogleConfig,
  config: ResolvedConfig,
  code: string,
  verifier: string,
): Promise<GoogleProfile | null> {
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(config),
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) return null;

  const parts = body.id_token.split('.');
  if (parts.length !== 3) return null;

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(utf8.decode(base64UrlToBytes(parts[1]!))) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!ISSUERS.has(String(claims.iss))) return null;
  if (claims.aud !== google.clientId) return null;
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;

  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}
