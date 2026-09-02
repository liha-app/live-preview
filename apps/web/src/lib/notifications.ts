/**
 * Sending someone to the notification origin.
 *
 * Notification permission is per origin and every preview is served from its
 * own, so asking here would ask again for every preview anyone opens. One
 * origin asks once and its service worker covers all of them — but permission
 * cannot be requested from a cross-origin iframe in any current browser, so
 * this is a place people go rather than something embedded.
 *
 * The grant travels in the fragment: browsers do not send it to servers and
 * proxies do not log it. The page spends it and takes it out of the URL.
 */
export function watchUrl(
  notificationOrigin: string,
  token: string,
  title: string,
  returnTo: string,
): string {
  const params = new URLSearchParams({ t: token, title, back: returnTo });
  return `${notificationOrigin.replace(/\/$/, '')}/#${params.toString()}`;
}

/** Whether this browser could receive push at all. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}
