/**
 * There is no account system: a preview's owner is whoever holds its token.
 * Tokens live in localStorage, scoped per slug, and never leave this origin —
 * preview content is served from a different origin precisely so uploaded HTML
 * cannot read them.
 */
const OWNER_PREFIX = 'liha.owner.';
const REVIEW_PREFIX = 'liha.review.';
const NAME_KEY = 'liha.reviewer-name';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private browsing, quota, etc. — previews still work, just not remembered */
  }
}

export const ownerTokens = {
  get: (slug: string) => read(OWNER_PREFIX + slug),
  set: (slug: string, token: string | null) => write(OWNER_PREFIX + slug, token),
};

export const reviewSessions = {
  get: (slug: string) => read(REVIEW_PREFIX + slug),
  set: (slug: string, token: string | null) => write(REVIEW_PREFIX + slug, token),
};

export const reviewerName = {
  get: () => read(NAME_KEY) ?? '',
  set: (name: string) => write(NAME_KEY, name),
};

/**
 * Owner links carry the token in the URL fragment (`#owner=…`) so it is never
 * sent to a server or written to an access log. Capture it, then scrub the URL.
 */
export function captureOwnerTokenFromHash(slug: string): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#owner=')) return null;
  const token = decodeURIComponent(hash.slice('#owner='.length));
  if (!token) return null;
  ownerTokens.set(slug, token);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}
