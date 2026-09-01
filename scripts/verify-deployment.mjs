#!/usr/bin/env node
/**
 * Smoke-tests a deployed Liha instance from the outside.
 *
 * The test suite proves the code is correct. This proves a *deployment* is
 * correct — a different thing, and where the mistakes actually live: a wildcard
 * DNS record that never propagated, a CSP that blocks the API, a content origin
 * that is accidentally the same as the app origin.
 *
 *   node scripts/verify-deployment.mjs --api https://api.example.com \
 *                                      --app https://liha.example.com
 *
 * It creates a sample preview, exercises it, and deletes it again. Exits
 * non-zero if anything fails, so it can gate a deploy.
 */

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const GREEN = colour ? '[32m' : '';
const RED = colour ? '[31m' : '';
const DIM = colour ? '[2m' : '';
const RESET = colour ? '[0m' : '';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const API = (args.get('api') ?? process.env.LIHA_API_URL ?? 'http://localhost:8787').replace(
  /\/$/,
  '',
);
const APP = (args.get('app') ?? process.env.LIHA_APP_URL ?? '').replace(/\/$/, '');

const results = [];
let failures = 0;

/** Returned by a check that cannot apply here — not a pass, but not a failure. */
const SKIP = Symbol('skip');
const skip = (reason) => ({ [SKIP]: reason });

function record(status, name, detail) {
  results.push({ status, name, detail });
  if (status === 'fail') failures += 1;
  const label = {
    pass: `${GREEN}ok${RESET}  `,
    fail: `${RED}FAIL${RESET}`,
    skip: `${DIM}skip${RESET}`,
  }[status];
  process.stdout.write(`  ${label}  ${name}\n`);
  if (detail) process.stdout.write(`        ${DIM}${detail}${RESET}\n`);
}

/** Runs one check; a thrown error is a failure rather than a crash. */
async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail && typeof detail === 'object' && SKIP in detail) {
      record('skip', name, detail[SKIP]);
      return;
    }
    record('pass', name, typeof detail === 'string' ? detail : undefined);
  } catch (error) {
    record('fail', name, error instanceof Error ? error.message : String(error));
  }
}

/** Splits a CSP header into `{ 'connect-src': ['\'self\'', 'https://…'] }`. */
function parseCsp(header) {
  const directives = {};
  for (const part of header.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return directives;
}

/**
 * Whether a CSP source list permits an origin. Keyword sources such as `'self'`
 * never cover a cross-origin host, which is the case we care about here.
 */
function cspAllows(sources, origin) {
  const target = new URL(origin);
  return sources.some((source) => {
    if (source === '*') return true;
    if (source.startsWith("'")) return false;
    const written = source.includes('://') ? source : `${target.protocol}//${source}`;
    let host;
    try {
      host = new URL(written).host;
    } catch {
      return false;
    }
    if (host.startsWith('*.')) return target.host.endsWith(host.slice(1));
    return host === target.host;
  });
}

const isLoopback = (origin) => {
  const { hostname } = new URL(origin);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected JSON, got: ${text.slice(0, 120)}`);
  }
}

/**
 * Fetches preview content.
 *
 * Browsers resolve any `*.localhost` name to the loopback address, which is
 * what gives each preview its own origin in local development. Node's resolver
 * does not, so for those hosts the request goes to the loopback address with
 * the original name in the Host header — exactly what the browser would send.
 * Real deployments use real DNS and take the plain path.
 */
async function fetchContent(input) {
  const url = new URL(input);
  if (!url.hostname.endsWith('.localhost')) return fetch(url);

  const { request } = await import(url.protocol === 'https:' ? 'node:https' : 'node:http');
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: '127.0.0.1',
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { host: url.host },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: { get: (name) => response.headers[name.toLowerCase()] ?? null },
            text: async () => Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    call.on('error', reject);
    call.end();
  });
}

process.stdout.write(`\nVerifying Liha\n  api  ${API}\n  app  ${APP || '(not given)'}\n\n`);

// ----------------------------------------------------------------- the API

let created;
let slug;

await check('API is reachable and healthy', async () => {
  const response = await fetch(`${API}/api/health`);
  assert(response.ok, `GET /api/health returned ${response.status}`);
  const body = await json(response);
  assert(body.ok === true, 'health response did not report ok');
  return body.service;
});

if (APP) {
  await check('API allows the app origin (CORS)', async () => {
    const response = await fetch(`${API}/api/health`, { headers: { origin: APP } });
    const allow = response.headers.get('access-control-allow-origin');
    assert(allow === APP, `access-control-allow-origin was "${allow}", expected "${APP}"`);
    return allow;
  });
}

await check('creates the sample preview', async () => {
  const response = await fetch(`${API}/api/previews/demo`, { method: 'POST' });
  assert(response.status === 201, `POST /api/previews/demo returned ${response.status}`);
  created = await json(response);
  slug = created.preview.slug;
  assert(created.ownerToken?.startsWith('liha_ot_'), 'no owner token returned');
  return `${slug} with ${created.preview.openCommentCount} open thread(s)`;
});

if (!created) {
  process.stdout.write('\nCannot continue without a preview.\n');
  process.exit(1);
}

const contentUrl = created.preview.contentUrl;
const contentOrigin = contentUrl ? new URL(contentUrl).origin : null;

await check('the share URL is somewhere a reviewer can be sent', async () => {
  const share = created.preview.shareUrl;
  assert(share, 'preview has no shareUrl');

  // Either shape is a working deployment: a path on the app, or a hostname of
  // the preview's own. Which one depends on REVIEW_ORIGIN_TEMPLATE.
  const onApp = APP && share.startsWith(`${APP}/p/`);
  const ownHost = new URL(share).hostname.includes(slug);
  assert(
    onApp || ownHost,
    `shareUrl is ${share}, which is neither under ${APP || 'the app'} nor a host of its own. ` +
      'Check APP_ORIGIN and REVIEW_ORIGIN_TEMPLATE.',
  );

  if (!ownHost) return `${share} (a path on the app)`;

  /*
   * A dedicated host has to actually serve the app, and the app has to be told
   * which preview it is. Without the stamp it renders the landing page on a
   * hostname that promised a review.
   */
  const response = await fetchContent(share);
  assert(response.ok, `GET ${share} returned ${response.status}`);
  const html = await response.text();
  assert(
    html.includes(`content="${slug}"`),
    `${share} served a page that does not name this preview, so it will render the landing page.`,
  );
  assert(
    new URL(share).origin !== new URL(contentUrl ?? 'https://x.invalid').origin,
    'the review screen and the artifact share an origin, so uploaded HTML can read the owner token',
  );

  /*
   * And it has to be allowed to talk to the API. A review screen is its own
   * origin, so it is not the app origin CORS was configured for — miss this and
   * the page loads perfectly and then says it cannot reach the server.
   */
  const origin = new URL(share).origin;
  const cors = await fetch(`${API}/api/health`, { headers: { origin } });
  assert(
    cors.headers.get('access-control-allow-origin') === origin,
    `the API does not allow ${origin}, so the review screen will load and then fail every call. ` +
      `It answered "${cors.headers.get('access-control-allow-origin')}".`,
  );

  return `${share} serves the app for ${slug}, and may call the API`;
});

// -------------------------------------------------------- content isolation

await check('preview content is served from a separate origin', async () => {
  assert(contentUrl, 'preview has no contentUrl');
  assert(
    contentOrigin !== new URL(API).origin,
    `content is on the API origin (${contentOrigin}). Set CONTENT_ORIGIN_TEMPLATE to a wildcard ` +
      'host, or uploaded HTML is not origin-isolated.',
  );
  if (APP) assert(contentOrigin !== new URL(APP).origin, 'content shares the app origin');
  return contentOrigin;
});

if (APP) {
  await check('the app is allowed to reach the API and the content host (CSP)', async () => {
    const response = await fetch(`${APP}/`);
    assert(response.ok, `GET ${APP}/ returned ${response.status}`);

    const header = response.headers.get('content-security-policy');
    if (!header) {
      if (isLoopback(APP)) {
        return skip(
          'the dev server sends no CSP; Cloudflare Pages applies apps/web/public/_headers',
        );
      }
      throw new Error(
        'the app is served without a Content-Security-Policy, so apps/web/public/_headers was ' +
          'not applied. On Pages the file must sit in the directory you deploy.',
      );
    }

    const directives = parseCsp(header);
    const of = (name) => directives[name] ?? directives['default-src'] ?? [];

    /*
     * Every way the app reaches something, and what breaks when a directive
     * forgets it. Each artifact type takes a different route to the same
     * origin, so a policy can be right for one and blank for another — an
     * image preview showed its filename and nothing else for exactly this
     * reason, while HTML previews were fine.
     */
    for (const [directive, origin, consequence] of [
      ['connect-src', API, 'the app cannot call its own API'],
      [
        'connect-src',
        contentOrigin,
        'PDF previews stay blank and agents cannot read artifact source',
      ],
      ['img-src', contentOrigin, 'image previews render as nothing'],
      ['frame-src', contentOrigin, 'HTML previews render as nothing'],
    ]) {
      const sources = of(directive);
      assert(
        cspAllows(sources, origin),
        `${directive} does not permit ${origin}, so ${consequence}. It reads ` +
          `"${sources.join(' ') || '(empty)'}" — edit ${directive} in apps/web/public/_headers.`,
      );
    }

    return 'connect-src, img-src and frame-src all reach what the app loads';
  });
}

await check('content host resolves and serves the artifact', async () => {
  const response = await fetchContent(contentUrl);
  assert(
    response.ok,
    `GET ${contentUrl} returned ${response.status}. Wildcard DNS or the certificate may be missing.`,
  );
  const html = await response.text();
  assert(html.includes('Get started now'), 'served page is not the sample artifact');
  assert(html.includes('data-liha-bridge'), 'the review bridge was not injected');
  return `${html.length} bytes, bridge injected`;
});

await check('content carries its sandbox headers', async () => {
  const response = await fetchContent(contentUrl);
  const csp = response.headers.get('content-security-policy') ?? '';
  assert(csp.includes('sandbox'), 'no CSP sandbox directive on content');
  assert(
    !csp.includes('allow-same-origin'),
    'CSP grants allow-same-origin, so uploaded HTML would not be isolated',
  );
  assert(
    response.headers.get('x-content-type-options') === 'nosniff',
    'missing X-Content-Type-Options: nosniff',
  );
  assert(
    response.headers.get('referrer-policy') === 'no-referrer',
    'missing Referrer-Policy: no-referrer',
  );
  return 'sandbox, nosniff, no-referrer';
});

await check('root-absolute assets resolve', async () => {
  const asset = new URL('/assets/site.css', contentOrigin);
  const response = await fetchContent(asset);
  assert(response.ok, `GET ${asset} returned ${response.status}`);
  assert(
    (response.headers.get('content-type') ?? '').includes('text/css'),
    'stylesheet served with the wrong content type',
  );
  return String(asset);
});

await check('path traversal is refused', async () => {
  const outcomes = [];
  for (const path of ['/..%2f..%2fmanifest.json', '/%2e%2e%2fmanifest.json', '/manifest.json']) {
    const response = await fetchContent(new URL(path, contentOrigin));
    assert(!response.ok, `${path} unexpectedly returned ${response.status}`);
    outcomes.push(`${path} ${response.status}`);
  }
  return outcomes.join(' · ');
});

// --------------------------------------------------------------- the review

let rootComment;

await check('seeded feedback carries DOM context', async () => {
  const response = await fetch(`${API}/api/previews/${slug}/comments?status=open`);
  const body = await json(response);
  rootComment = body.comments.find((comment) => comment.parentId === null);
  assert(rootComment, 'no top-level comment found');
  assert(
    rootComment.target.element?.selector === '#cta',
    `expected a comment anchored to #cta, got ${rootComment.target.element?.selector}`,
  );
  assert(rootComment.replyCount >= 1, 'the seeded thread has no reply');
  return `${rootComment.target.element.selector}, ${rootComment.replyCount} reply`;
});

await check('anyone with the link can reply in a thread', async () => {
  const response = await fetch(`${API}/api/previews/${slug}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      authorName: 'deployment check',
      body: 'Reply posted by verify-deployment.mjs',
      parentId: rootComment.id,
    }),
  });
  assert(response.status === 201, `reply returned ${response.status}`);
  const body = await json(response);
  assert(body.comment.parentId === rootComment.id, 'reply did not join the thread');
  return body.comment.id;
});

await check('resolving requires the owner token', async () => {
  const response = await fetch(`${API}/api/previews/${slug}/comments/${rootComment.id}/resolve`, {
    method: 'POST',
  });
  assert(response.status === 401, `expected 401 without a token, got ${response.status}`);
  return 'refused without a token';
});

await check('the owner can resolve a thread', async () => {
  const response = await fetch(`${API}/api/previews/${slug}/comments/${rootComment.id}/resolve`, {
    method: 'POST',
    headers: { 'x-liha-owner-token': created.ownerToken },
  });
  assert(response.ok, `resolve returned ${response.status}`);
  const body = await json(response);
  assert(body.comment.status === 'resolved', 'comment did not become resolved');
  return 'thread resolved';
});

// ------------------------------------------------------------------ tidy up

await check('deletes the sample preview again', async () => {
  const response = await fetch(`${API}/api/previews/${slug}`, {
    method: 'DELETE',
    headers: { 'x-liha-owner-token': created.ownerToken },
  });
  assert(response.ok, `delete returned ${response.status}`);
  const after = await fetch(`${API}/api/previews/${slug}`);
  assert(after.status === 404, `preview still readable after delete (${after.status})`);
  return 'removed';
});

// --------------------------------------------------------------------- done

const skipped = results.filter((item) => item.status === 'skip').length;
const passed = results.length - failures - skipped;
process.stdout.write(
  `\n${passed}/${results.length - skipped} checks passed` +
    (skipped ? ` (${skipped} skipped)` : '') +
    '\n',
);

if (failures > 0) {
  process.stdout.write('\nFailed:\n');
  for (const result of results.filter((item) => item.status === 'fail')) {
    process.stdout.write(`  ${result.name}\n    ${result.detail}\n`);
  }
  process.stdout.write('\nSee docs/deployment.md.\n');
  process.exit(1);
}

process.stdout.write('\nThe deployment looks healthy.\n');
if (APP) {
  process.stdout.write(
    `\nNext, open ${APP} in ChatGPT's in-app browser, press "Open a sample review",\n` +
      'and ask: "What review feedback is open on this preview, and what does it point at?"\n',
  );
}
