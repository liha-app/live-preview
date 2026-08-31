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

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? `${GREEN}ok${RESET}  ` : `${RED}FAIL${RESET}`}  ${name}\n`);
  if (detail) process.stdout.write(`        ${DIM}${detail}${RESET}\n`);
}

/** Runs one check; a thrown error is a failure rather than a crash. */
async function check(name, fn) {
  try {
    const detail = await fn();
    record(true, name, typeof detail === 'string' ? detail : undefined);
  } catch (error) {
    record(false, name, error instanceof Error ? error.message : String(error));
  }
}

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

if (APP) {
  await check('share URL points at the app', async () => {
    assert(
      created.preview.shareUrl.startsWith(`${APP}/p/`),
      `shareUrl is ${created.preview.shareUrl}, expected it under ${APP}. Check APP_ORIGIN.`,
    );
    return created.preview.shareUrl;
  });
}

// -------------------------------------------------------- content isolation

const contentUrl = created.preview.contentUrl;
const contentOrigin = contentUrl ? new URL(contentUrl).origin : null;

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

const passed = results.length - failures;
process.stdout.write(`\n${passed}/${results.length} checks passed\n`);

if (failures > 0) {
  process.stdout.write('\nFailed:\n');
  for (const result of results.filter((item) => !item.ok)) {
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
