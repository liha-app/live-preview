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

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 524.21 627.96"><g><g><g><path fill="#e54744" d="M48.76,85.33c-.92,2.44-1.97,3.8-3.56,3.99-8.58,1.02-6.13-26.75-24.29-33.84l-17.63-6.89C1.16,47.76-.08,46.46,0,44.53c.31-7.54,26.53-4.67,34.32-24.43l6.89-17.48c.66-1.67,2.62-2.81,3.88-2.6,7.07,1.18,4.53,27.52,25.42,35.12l15.28,5.56c1.77.64,3.19,2.38,3.16,3.81-.11,7.5-27.27,6.46-33.68,23.48l-6.52,17.34Z"/><path fill="#e84644" d="M522.37,517.26c-6.32-39.3-38.5-70.54-78.77-70.61l-93.8-.16c-13.6-.02-25.55-9.63-25.58-24.03l-.51-244.79c-.14-67.96-57.19-122.58-124.64-123.15-68.88-.58-126.73,55.22-126.8,124.42l-.28,304.72c-.04,41.93-15.15,64.75-17.25,83.69-2.21,19.93,6,39.1,23.05,50.05,26.37,16.93,60.57,7.83,76.72-18.7,3.58-5.88,9.23-10.67,16.37-9.78,7.58.95,12.98,6.9,16.28,13.47,7.54,15.04,21.42,24.56,37.72,25.48,16,.91,30.22-7.48,39.59-21l8.92-12.88c7.01-7.2,17.86-7.56,23.5.47l8.83,12.59c9.37,13.35,22.92,21.1,38.31,20.86,15.26-.24,28.84-8.6,36.99-22.12,5.44-9.04,10.91-17.68,20.81-16.97,11.16.8,15.43,16.93,29.38,27.02,23.66,17.1,56.75,11.68,75.01-11.07,17.59-21.91,20.6-59.75,16.14-87.52ZM284.8,217.88c-.82,23.59-13.93,43.92-34.01,56.79-29.39,18.82-65.79,19.93-96.21,4.35-38.7-19.81-54.84-63.86-29.76-100.55,27.46-40.17,88.68-47.78,129.51-19.04,19.28,13.57,31.29,34.78,30.47,58.45Z"/></g><path fill="#e64844" d="M180.14,226.08c.05,7.15-6.14,11.6-11.76,11.85s-12.67-3.56-12.74-10.18l-.21-22.15c-.06-6.77,5.71-11.52,11.85-11.97,6.22-.45,12.66,5.11,12.71,11.99l.15,20.47Z"/><path fill="#e74945" d="M242.85,225.99c.07,7.81-6.87,12.15-13.12,11.89-6.58-.28-11.55-5.3-11.53-12.75l.07-19.23c.03-6.8,5.43-11.89,11.57-12.35,6.74-.51,12.78,4.71,12.84,12.13l.17,20.31Z"/></g></g></svg>`;

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
h2 { font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase;
     letter-spacing: 0.04em; margin: 26px 0 8px; }
ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
li { display: flex; align-items: center; gap: 10px; padding: 9px 0;
     border-bottom: 1px solid var(--line); font-size: 14px; }
li a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.quiet-btn {
  background: transparent; color: var(--muted); border-color: var(--line);
  padding: 5px 10px; font-size: 13px; font-weight: 400;
}
button.quiet-btn:hover { color: var(--fg); }
`;

/*
 * Inlined rather than linked: this origin serves only the three things it
 * prints, so there is nowhere to link to.
 */
const RING = `<svg class="ring" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 524.21 627.96"><g><g><g><path fill="#e54744" d="M48.76,85.33c-.92,2.44-1.97,3.8-3.56,3.99-8.58,1.02-6.13-26.75-24.29-33.84l-17.63-6.89C1.16,47.76-.08,46.46,0,44.53c.31-7.54,26.53-4.67,34.32-24.43l6.89-17.48c.66-1.67,2.62-2.81,3.88-2.6,7.07,1.18,4.53,27.52,25.42,35.12l15.28,5.56c1.77.64,3.19,2.38,3.16,3.81-.11,7.5-27.27,6.46-33.68,23.48l-6.52,17.34Z"/><path fill="#e84644" d="M522.37,517.26c-6.32-39.3-38.5-70.54-78.77-70.61l-93.8-.16c-13.6-.02-25.55-9.63-25.58-24.03l-.51-244.79c-.14-67.96-57.19-122.58-124.64-123.15-68.88-.58-126.73,55.22-126.8,124.42l-.28,304.72c-.04,41.93-15.15,64.75-17.25,83.69-2.21,19.93,6,39.1,23.05,50.05,26.37,16.93,60.57,7.83,76.72-18.7,3.58-5.88,9.23-10.67,16.37-9.78,7.58.95,12.98,6.9,16.28,13.47,7.54,15.04,21.42,24.56,37.72,25.48,16,.91,30.22-7.48,39.59-21l8.92-12.88c7.01-7.2,17.86-7.56,23.5.47l8.83,12.59c9.37,13.35,22.92,21.1,38.31,20.86,15.26-.24,28.84-8.6,36.99-22.12,5.44-9.04,10.91-17.68,20.81-16.97,11.16.8,15.43,16.93,29.38,27.02,23.66,17.1,56.75,11.68,75.01-11.07,17.59-21.91,20.6-59.75,16.14-87.52ZM284.8,217.88c-.82,23.59-13.93,43.92-34.01,56.79-29.39,18.82-65.79,19.93-96.21,4.35-38.7-19.81-54.84-63.86-29.76-100.55,27.46-40.17,88.68-47.78,129.51-19.04,19.28,13.57,31.29,34.78,30.47,58.45Z"/></g><path fill="#e64844" d="M180.14,226.08c.05,7.15-6.14,11.6-11.76,11.85s-12.67-3.56-12.74-10.18l-.21-22.15c-.06-6.77,5.71-11.52,11.85-11.97,6.22-.45,12.66,5.11,12.71,11.99l.15,20.47Z"/><path fill="#e74945" d="M242.85,225.99c.07,7.81-6.87,12.15-13.12,11.89-6.58-.28-11.55-5.3-11.53-12.75l.07-19.23c.03-6.8,5.43-11.89,11.57-12.35,6.74-.51,12.78,4.71,12.84,12.13l.17,20.31Z"/></g></g></svg>`;

export function watchPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notifications — Liha</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(MARK_SVG)}">
<style>${SHARED_CSS}</style>
</head><body>
<main>
  ${RING}
  <h1 id="head">Notifications</h1>
  <p id="body">Getting ready…</p>
  <p><button id="go" hidden></button></p>
  <section id="watching" hidden>
    <h2>Being told about</h2>
    <ul id="list"></ul>
    <p><button id="stopAll" class="quiet-btn">Stop all notifications</button></p>
  </section>
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
const watching = document.getElementById('watching');
const list = document.getElementById('list');
const stopAll = document.getElementById('stopAll');

let token = null;
let title = 'this preview';
let returnTo = null;

/*
 * The grant arrives in the fragment, which browsers do not send to servers and
 * proxies do not log. It is spent immediately and taken out of the URL.
 *
 * Read on hashchange as well as at load: arriving here when this page is
 * already open changes only the fragment, and that reloads nothing.
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

function baseDomain() {
  return location.hostname.split('.').slice(-2).join('.');
}

/** Only somewhere this deployment serves, never wherever a link says. */
function safeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== location.hostname && !url.hostname.endsWith('.' + baseDomain())) return null;
  return url;
}

function offerReturn() {
  const url = returnTo && safeUrl(returnTo);
  if (!url) return;
  const link = document.createElement('a');
  link.href = url.href;
  link.textContent = 'Back to the review';
  back.replaceChildren(link);
  back.hidden = false;
}

function keyBytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/*
 * The worker needs to know who it is to ask what it missed. The Cache API is
 * shared between this page and the worker on the same origin, so writing it
 * here is enough — no message passing, and nothing to go stale if the worker is
 * asleep when this runs.
 */
async function identity(next) {
  const store = await caches.open('liha-identity');
  if (next === undefined) {
    const held = await store.match('/id');
    return held ? (await held.json()).id : null;
  }
  if (next === null) await store.delete('/id');
  else await store.put('/id', new Response(JSON.stringify({ id: next })));
  return next;
}

async function post(path, payload) {
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(path + ' failed: ' + response.status);
  return response.json();
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

  const result = await post('/api/push/subscribe', {
    endpoint: subscription.endpoint,
    watchToken: token,
  });
  await identity(result.subscriptionId);
  return result;
}

/** Everything this browser has asked to be told about, with a way to stop. */
async function renderWatching() {
  const id = await identity();
  if (!id) {
    watching.hidden = true;
    return 0;
  }

  let items = [];
  try {
    items = (await post('/api/push/watches', { subscriptionId: id })).items || [];
  } catch {
    watching.hidden = true;
    return 0;
  }

  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    const url = safeUrl(item.url);
    if (url) link.href = url.href;
    link.textContent = item.title;
    const stop = document.createElement('button');
    stop.className = 'quiet-btn';
    stop.textContent = 'Stop';
    stop.addEventListener('click', async () => {
      stop.disabled = true;
      await post('/api/push/unsubscribe', { subscriptionId: id, previewId: item.previewId });
      await renderWatching();
    });
    row.append(link, stop);
    list.append(row);
  }

  watching.hidden = items.length === 0;
  return items.length;
}

stopAll.addEventListener('click', async () => {
  stopAll.disabled = true;
  const id = await identity();
  if (id) await post('/api/push/unsubscribe', { subscriptionId: id });

  // Tell the browser too, or it keeps a subscription pointed at a server that
  // has forgotten it.
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration && (await registration.pushManager.getSubscription());
  if (subscription) await subscription.unsubscribe();
  await identity(null);

  stopAll.disabled = false;
  await renderWatching();
  say('Stopped', 'Nothing will be sent to this browser.');
});

async function start() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    say(
      'Not supported here',
      'This browser cannot receive web push. On iPhone, add this page to the Home Screen first.',
      true,
    );
    return;
  }

  if (Notification.permission === 'denied') {
    say(
      'Notifications are blocked',
      'Allow notifications for this site in your browser settings, then try again.',
      true,
    );
    offerReturn();
    await renderWatching();
    return;
  }

  // No grant: this is somebody coming to see or change what they already have.
  if (!token) {
    const count = await renderWatching();
    if (count > 0) say('Notifications', 'You are being told about the reviews below.');
    else
      say(
        'Nothing set up',
        'Open this from a review screen to be told when someone comments on it.',
      );
    return;
  }

  // Already allowed: a second preview, and nothing to ask.
  if (Notification.permission === 'granted') {
    try {
      await subscribe();
      say('Done', 'You will be told when someone comments on ' + title + '.');
    } catch (error) {
      say('That did not work', String((error && error.message) || error), true);
    }
    offerReturn();
    await renderWatching();
    return;
  }

  say(
    'Notifications',
    'Allow notifications once here, and you will be told about comments on ' +
      title +
      ' — and on anything else you ask to watch.',
  );
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
      say('That did not work', String((error && error.message) || error), true);
      go.disabled = false;
    }
    offerReturn();
    await renderWatching();
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
