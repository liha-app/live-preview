import { LIMITS, generateId, hashToken, randomString } from '@liha/shared';
import type { Database } from './ports.js';
import type { ResolvedConfig } from './env.js';
import {
  findAccount,
  findAccountByGoogleSub,
  findSession,
  insertAccount,
  insertSession,
  linkGoogleAccount,
  touchAccount,
  touchSession,
  type AccountRow,
} from './repo.js';

/**
 * Who is asking, without ever having asked them to sign up.
 *
 * An account is minted the first time a browser does anything and lives in a
 * cookie. Signing in with Google links that same account rather than making a
 * second one, so what is already attached to it comes along — which is the
 * whole reason the anonymous account exists rather than starting at sign-in.
 *
 * The cookie is on the API origin because that is the only origin all the
 * screens share: the app is on one domain, every review screen is its own host
 * on another, and localStorage cannot span them.
 */

export const SESSION_COOKIE = 'liha_session';

/**
 * The header that makes the cookie count.
 *
 * `SameSite=None` is unavoidable — the review screens are on a different site
 * from the API — so the cookie rides along on cross-site requests, and that is
 * CSRF. A custom header cannot be set by a cross-site form or image, and asking
 * for one forces a preflight that this API only answers for its own origins.
 * So: no header, no session, and a forged request is just an anonymous one.
 */
export const APP_HEADER = 'x-liha-app';

export interface Caller {
  account: AccountRow | null;
  /** Set when a session was created or refreshed and must be sent back. */
  setCookie: string | null;
}

/** Reads one cookie off a request. */
export function readCookie(request: Request, name: string): string | null {
  return cookieValue(request.headers.get('cookie'), name);
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

function serializeCookie(token: string, config: ResolvedConfig): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${Math.floor(LIMITS.sessionLifetimeMs / 1000)}`,
    'HttpOnly',
    // A review screen is on a different site from the API, so the cookie has to
    // be allowed cross-site. `Secure` is required with `None`.
    'SameSite=None',
    'Secure',
  ];
  // Local development is not https, and a `Secure` cookie would simply never be
  // stored. Same-site there, so it works without either.
  if (config.apiOrigin.startsWith('http://')) {
    return [
      `${SESSION_COOKIE}=${token}`,
      'Path=/',
      `Max-Age=${Math.floor(LIMITS.sessionLifetimeMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
    ].join('; ');
  }
  return attributes.join('; ');
}

/** Reads the caller's account, if the request is allowed to carry one. */
export async function readCaller(
  db: Database,
  request: Request,
  config: ResolvedConfig,
): Promise<Caller> {
  if (request.headers.get(APP_HEADER) === null) return { account: null, setCookie: null };

  const token = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return { account: null, setCookie: null };

  const session = await findSession(db, await hashToken(token));
  if (!session) return { account: null, setCookie: null };

  const account = await findAccount(db, session.account_id);
  if (!account) return { account: null, setCookie: null };

  // Sessions slide, but not on every request: an hour's granularity keeps a
  // long window long without a write per page load.
  if (Date.now() - Date.parse(session.last_seen_at) > LIMITS.useTouchIntervalMs) {
    await touchSession(db, session.token_hash);
    await touchAccount(db, account.id);
  }
  return { account, setCookie: null };
}

/**
 * The caller's account, making an anonymous one if they have none.
 *
 * Called only where an identity is actually needed — creating a preview,
 * leaving a comment — so a passer-by who only reads is never given one.
 */
export async function requireCaller(
  db: Database,
  request: Request,
  config: ResolvedConfig,
): Promise<Caller> {
  const existing = await readCaller(db, request, config);
  if (existing.account) return existing;
  if (request.headers.get(APP_HEADER) === null) return { account: null, setCookie: null };

  const now = new Date().toISOString();
  const account: AccountRow = {
    id: generateId('account'),
    google_sub: null,
    email: null,
    display_name: null,
    created_at: now,
    last_seen_at: now,
  };
  await insertAccount(db, account);

  const token = `liha_se_${randomString(32)}`;
  await insertSession(db, {
    token_hash: await hashToken(token),
    account_id: account.id,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(Date.now() + LIMITS.sessionLifetimeMs).toISOString(),
  });

  return { account, setCookie: serializeCookie(token, config) };
}

/**
 * Signs an account in as a Google user.
 *
 * If that Google identity is already an account, the two are merged into it —
 * signing in on a second browser must not strand what the first one made. The
 * anonymous account being merged from is emptied rather than left as a second
 * owner of the same things.
 */
export async function signInWithGoogle(
  db: Database,
  current: AccountRow | null,
  profile: { sub: string; email: string | null; name: string | null },
): Promise<{ account: AccountRow; merged: string | null }> {
  const existing = await findAccountByGoogleSub(db, profile.sub);

  if (existing) {
    if (current && current.id !== existing.id && !current.google_sub) {
      return { account: existing, merged: current.id };
    }
    await touchAccount(db, existing.id);
    return { account: existing, merged: null };
  }

  if (current && !current.google_sub) {
    await linkGoogleAccount(db, current.id, profile);
    const linked = await findAccount(db, current.id);
    if (linked) return { account: linked, merged: null };
  }

  const now = new Date().toISOString();
  const account: AccountRow = {
    id: generateId('account'),
    google_sub: profile.sub,
    email: profile.email,
    display_name: profile.name,
    created_at: now,
    last_seen_at: now,
  };
  await insertAccount(db, account);
  return { account, merged: null };
}

/** Issues a fresh session cookie for an account. */
export async function startSession(
  db: Database,
  accountId: string,
  config: ResolvedConfig,
): Promise<string> {
  const token = `liha_se_${randomString(32)}`;
  const now = new Date().toISOString();
  await insertSession(db, {
    token_hash: await hashToken(token),
    account_id: accountId,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(Date.now() + LIMITS.sessionLifetimeMs).toISOString(),
  });
  return serializeCookie(token, config);
}

export function clearCookie(config: ResolvedConfig): string {
  return config.apiOrigin.startsWith('http://')
    ? `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    : `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure`;
}
