/**
 * The notification origin.
 *
 * Every preview is served from its own hostname, and notification permission is
 * per origin — so asking on the review screen would ask again for every preview
 * anyone ever opens. One origin asks once, and its service worker shows
 * notifications for all of them.
 *
 * Permission also cannot be requested from a cross-origin iframe in any current
 * browser, so this is a page the review screen sends you to, not something it
 * embeds. It is served from the Worker rather than the app bundle because it has
 * to be told the VAPID public key and where the API is, and because it must stay
 * reachable when the app is not.
 */

export interface SitePages {
  /** The VAPID public key browsers subscribe with. */
  vapidPublicKey: string;
  apiOrigin: string;
}

const SHARED_CSS = `
:root {
  --bg: #ffffff; --fg: #16181c; --muted: #5c636e; --line: #e6e6e6;
  --mark: #e5484d; --accent: #1a1a1a; --accent-fg: #ffffff;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #101012; --fg: #ededef; --muted: #a0a1aa; --line: #26272b;
          --accent: #ededef; --accent-fg: #101012; }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
main { width: 100%; max-width: 420px; }
.ring { width: 34px; height: 34px; margin-bottom: 18px; }
h1 { font-size: 19px; margin: 0 0 8px; font-weight: 600; }
p { margin: 0 0 18px; color: var(--muted); }
button {
  font: inherit; font-weight: 500; cursor: pointer;
  border: 1px solid var(--accent); border-radius: 8px; padding: 9px 16px;
  background: var(--accent); color: var(--accent-fg);
}
button[disabled] { opacity: 0.5; cursor: default; }
a { color: inherit; }
.quiet { font-size: 13px; }
.bad { color: var(--mark); }
`;

const RING = `<svg class="ring" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="#e5484d" stroke-width="3.5"/></svg>`;

export function watchPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notifications — Liha</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Ccircle%20cx%3D%2216%22%20cy%3D%2216%22%20r%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23e5484d%22%20stroke-width%3D%223.5%22%2F%3E%3C%2Fsvg%3E">
<style>${SHARED_CSS}</style>
</head><body>
<main>
  ${RING}
  <h1 id="head">Notifications</h1>
  <p id="body">Getting ready…</p>
  <p><button id="go" hidden></button></p>
  <p class="quiet" id="back" hidden></p>
</main>
<script src="/app.js"></script>
</body></html>`;
}

/**
 * The page's own script.
 *
 * Kept out of the HTML so the policy can stay `script-src 'self'` — this origin
 * holds a notification permission, which is exactly the kind of thing not to
 * protect with `unsafe-inline`.
 */
export function watchScript(pages: SitePages): string {
  return `
const API = ${JSON.stringify(pages.apiOrigin)};
const VAPID = ${JSON.stringify(pages.vapidPublicKey)};

const head = document.getElementById('head');
const body = document.getElementById('body');
const go = document.getElementById('go');
const back = document.getElementById('back');

// The grant arrives in the fragment, which browsers do not send to servers and
// proxies do not log. It is spent immediately and taken out of the URL.
let token = null;
let title = 'this preview';
let returnTo = null;

/*
 * The grant arrives in the fragment, which browsers do not send to servers and
 * proxies do not log. It is spent immediately and taken out of the URL.
 *
 * Read on hashchange as well as at load: arriving at this page when it is
 * already open changes only the fragment, and a fragment change does not
 * reload anything.
 */
function readGrant() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.get('t')) return false;
  token = params.get('t');
  title = params.get('title') || 'this preview';
  returnTo = params.get('back');
  history.replaceState(null, '', location.pathname);
  return true;
}
readGrant();
window.addEventListener('hashchange', () => {
  if (readGrant()) void start();
});

function say(heading, text, isBad) {
  head.textContent = heading;
  body.textContent = text;
  body.className = isBad ? 'bad' : '';
}

function offerReturn() {
  if (!returnTo) return;
  let url;
  try {
    url = new URL(returnTo);
  } catch {
    return;
  }
  // Only back to where you came from, never wherever a link says.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.hostname !== location.hostname && !url.hostname.endsWith('.' + baseDomain())) return;
  back.hidden = false;
  const a = document.createElement('a');
  a.href = url.href;
  a.textContent = 'Back to the review';
  back.replaceChildren(a);
}

function baseDomain() {
  const parts = location.hostname.split('.');
  return parts.slice(-2).join('.');
}

function keyBytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribe() {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID),
    }));

  const response = await fetch(API + '/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint, watchToken: token }),
  });
  if (!response.ok) throw new Error('subscribe failed: ' + response.status);
  const result = await response.json();

  // The worker needs to know who it is to ask what it missed. The Cache API is
  // shared between this page and the worker on the same origin, so writing it
  // here is enough — no message passing, and nothing to go stale if the worker
  // is asleep when this runs.
  const store = await caches.open('liha-identity');
  await store.put('/id', new Response(JSON.stringify({ id: result.subscriptionId })));
  return result;
}

async function start() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    say('Not supported here', 'This browser cannot receive web push. On iPhone, add this page to the Home Screen first.', true);
    return;
  }
  if (!token) {
    say('Nothing to set up', 'Open this from a review screen so it knows which preview to watch.', true);
    return;
  }
  if (Notification.permission === 'denied') {
    say('Notifications are blocked', 'Allow notifications for this site in your browser settings, then try again.', true);
    offerReturn();
    return;
  }

  // Already allowed: this is the second preview and there is nothing to ask.
  if (Notification.permission === 'granted') {
    try {
      await subscribe();
      say('Done', 'You will be told when someone comments on ' + title + '.');
    } catch (error) {
      say('That did not work', String(error && error.message ? error.message : error), true);
    }
    offerReturn();
    return;
  }

  say('Notifications', 'Allow notifications once here, and you will be told about comments on ' + title + ' — and on anything else you ask to watch.');
  go.hidden = false;
  go.textContent = 'Allow notifications';
  go.addEventListener('click', async () => {
    go.disabled = true;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      say('Not allowed', 'Nothing will be sent. You can change this in your browser settings.', true);
      offerReturn();
      return;
    }
    try {
      await subscribe();
      say('Done', 'You will be told when someone comments on ' + title + '.');
      go.hidden = true;
    } catch (error) {
      say('That did not work', String(error && error.message ? error.message : error), true);
      go.disabled = false;
    }
    offerReturn();
  });
}

void start();
`;
}

/**
 * The service worker.
 *
 * The push arrives empty, so this asks the API what it missed. That keeps the
 * payload encryption out of the product entirely, and means the text shown is
 * what is true when it is shown rather than when it was queued.
 *
 * `userVisibleOnly` was promised at subscribe time, so every push must end in a
 * notification — including the one where the fetch fails.
 */
export function serviceWorker(pages: SitePages): string {
  return `
const API = ${JSON.stringify(pages.apiOrigin)};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function identity() {
  const store = await caches.open('liha-identity');
  const held = await store.match('/id');
  return held ? (await held.json()).id : null;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let shown = false;
      try {
        const id = await identity();
        if (id) {
          // POST, not GET: the id is a credential, and a credential in a path
          // is a credential in somebody's access log.
          const response = await fetch(API + '/api/push/pending', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: id }),
          });
          if (response.ok) {
            const pending = await response.json();
            for (const item of pending.items || []) {
              shown = true;
              await self.registration.showNotification(item.title, {
                body: item.body,
                tag: item.tag,
                data: { url: item.url },
              });
            }
          }
        }
      } catch {
        // Falls through to the generic notification below.
      }
      // A subscription made with userVisibleOnly must always show something.
      if (!shown) {
        await self.registration.showNotification('New feedback', {
          body: 'Someone commented on a preview you are watching.',
          tag: 'liha-generic',
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;
}
