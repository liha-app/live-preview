/**
 * Comment drafts survive a reload.
 *
 * Losing half-typed feedback because a preview refreshed is the fastest way to
 * make someone stop leaving comments, so the composer's text is mirrored to
 * localStorage per preview and restored on mount.
 */
const KEY = (slug: string) => `liha.draft.${slug}`;

export interface StoredDraft {
  body: string;
  savedAt: number;
}

/** Drafts older than this are stale enough to be noise rather than help. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readDraft(slug: string): string {
  try {
    const raw = window.localStorage.getItem(KEY(slug));
    if (!raw) return '';
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed.body !== 'string') return '';
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY(slug));
      return '';
    }
    return parsed.body;
  } catch {
    return '';
  }
}

export function writeDraft(slug: string, body: string): void {
  try {
    if (body.trim().length === 0) window.localStorage.removeItem(KEY(slug));
    else window.localStorage.setItem(KEY(slug), JSON.stringify({ body, savedAt: Date.now() }));
  } catch {
    /* quota or private mode: the draft just will not survive a reload */
  }
}

export function clearDraft(slug: string): void {
  writeDraft(slug, '');
}
