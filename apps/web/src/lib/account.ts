import { useQuery } from '@tanstack/react-query';
import { API_URL, api } from './api.js';

/**
 * Whether to offer signing in, and whether now is a decent moment to ask.
 *
 * Everything works without an account, so this is an offer and never a gate.
 * That cuts both ways: it may be asked once somebody has something to lose,
 * and it may not be asked again after they have said no.
 */

const DISMISSED_KEY = 'liha.no-account-prompt';
const ASKED_KEY = 'liha.asked-account';

/*
 * Asked at most once a session, not once a page.
 *
 * Once a page turned out to mean once per comment, which is a dialog in front
 * of somebody who is in the middle of reviewing. "Not now" should also mean
 * something weaker than "never", and a new session is the natural place for it
 * to lapse.
 */
function readAsked(): boolean {
  try {
    return window.sessionStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissedForever(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissForever(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* private browsing: it will ask again next time, which is the safe way to be wrong */
  }
}

export function markAsked(): void {
  try {
    window.sessionStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* private browsing: asked once more than intended, which is the harmless way to be wrong */
  }
}

export function askedAlready(): boolean {
  return readAsked();
}

export interface AccountState {
  signedIn: boolean;
  email: string | null;
  /** False when this deployment has no Google client configured. */
  available: boolean;
  /** True when it is worth offering, right now, to this person. */
  worthAsking: boolean;
  retentionDays: { anonymous: number; signedIn: number };
  signInHref(returnTo: string): string;
}

export function useAccount(): AccountState {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.getMe() });

  const signedIn = me.data?.account?.signedIn ?? false;

  /*
   * Absent an answer, assume sign-in is offered.
   *
   * The first version treated "do not know yet" as "not available", so a slow
   * or blocked /api/me removed the only way in with no sign that anything was
   * wrong — a door that disappears rather than a page that fails. Hiding it is
   * the claim that needs evidence, not showing it: on a deployment with no
   * Google client the answer arrives in a moment and says so.
   */
  const available = me.isSuccess ? me.data.googleAvailable : true;

  return {
    signedIn,
    email: me.data?.account?.email ?? null,
    available,
    // The offer is a different matter: interrupting somebody on a guess is
    // worse than not interrupting them, so that one waits to be sure.
    worthAsking: me.isSuccess && available && !signedIn && !dismissedForever(),
    retentionDays: me.data?.retentionDays ?? { anonymous: 7, signedIn: 30 },
    signInHref: (returnTo: string) =>
      `${API_URL}/api/auth/google/start?return=${encodeURIComponent(returnTo)}`,
  };
}
