#!/usr/bin/env node
/**
 * Deploys Liha to your own Cloudflare account, start to finish.
 *
 *   pnpm run deploy              # ask what it needs, then do it
 *   pnpm run deploy --dry-run    # print the whole plan, touch nothing
 *   pnpm run deploy --reconfigure
 *   pnpm run deploy --service-prefix lp-
 *
 * It provisions D1 and R2, writes a generated Wrangler config, applies the
 * migrations, deploys the Worker, builds and deploys the web app to Pages,
 * points DNS at all of it, and finishes by running the fifteen outside-in
 * checks in scripts/verify-deployment.mjs. Re-running it is safe: every step
 * looks before it creates.
 *
 * Credentials: with a `CLOUDFLARE_API_TOKEN` it can also create DNS records and
 * attach the Pages custom domain. Without one it falls back to `wrangler login`
 * and prints the one or two records for you to add. The token is used for this
 * process only — it is never written to disk, never stored in the saved
 * configuration, and never passed as a command-line argument.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildHeaders } from './lib/headers.mjs';
import { CloudflareApi, ROOT, parseJsonOutput, run, wrangler } from './lib/cloudflare.mjs';
import {
  callout,
  closeInput,
  confirm,
  detail,
  done,
  fail,
  info,
  planned,
  prompt,
  promptSecret,
  step,
  style,
  warn,
} from './lib/tty.mjs';

const { bold, dim, reset } = style;

const WORKER_NAME = 'liha-live-preview';
const DATABASE_NAME = 'liha-live-preview';
const BUCKET_NAME = 'liha-live-preview';

const API_DIR = path.join(ROOT, 'apps', 'api');
const WEB_DIST = path.join(ROOT, 'apps', 'web', 'dist');
const GENERATED_CONFIG = path.join(API_DIR, 'wrangler.generated.toml');
const STATE_FILE = path.join(ROOT, '.liha', 'deploy.json');

/**
 * A proxied record has to exist for Cloudflare to accept traffic for a
 * hostname, but the address is never reached: the Worker route answers at the
 * edge. This is TEST-NET-1, reserved for documentation, so it cannot collide
 * with anything real.
 */
const PLACEHOLDER_ADDRESS = '192.0.2.1';

const argv = process.argv.slice(2);
const flags = new Set(argv);
const dryRun = flags.has('--dry-run');
const reconfigure = flags.has('--reconfigure');

/**
 * This service's slice of the preview domain: text in front of every hostname it
 * claims, so `lp-` gives `lp-ab12cd.example.net` for a review screen and
 * `lp-ab12cd--1.example.net` for that preview's artifact.
 *
 * Not decoration. A domain carrying more than one service needs each to hold an
 * unmistakable namespace, because the route has to be the bare wildcard —
 * Cloudflare rejects a wildcard in the middle of a hostname, so the Worker takes
 * everything and decides for itself which hostnames are its own.
 *
 * `--content-prefix` is still accepted; it was named before it applied to both.
 */
const prefixIndex = flags.has('--service-prefix')
  ? argv.indexOf('--service-prefix')
  : argv.indexOf('--content-prefix');
const servicePrefix = prefixIndex === -1 ? undefined : (argv[prefixIndex + 1] ?? '');

// --------------------------------------------------------------------- state

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
};

function saveState(state) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------- validation

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function validHostname(value) {
  if (!HOSTNAME.test(value)) return 'Use a bare hostname, such as liha.example.com.';
  return undefined;
}

/** The longest suffix the two names share, in whole labels. */
function sharedSuffix(a, b) {
  const left = a.split('.').reverse();
  const right = b.split('.').reverse();
  const shared = [];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) break;
    shared.unshift(left[i]);
  }
  return shared.join('.');
}

// ------------------------------------------------------------------ steps

async function collectConfiguration(state) {
  step('Where should it live?');

  if (state.appHost && !reconfigure) {
    detail(`Reusing the answers in ${path.relative(ROOT, STATE_FILE)}. --reconfigure to change.`);
    return {
      ...state,
      servicePrefix: servicePrefix ?? state.servicePrefix ?? state.contentPrefix ?? '',
    };
  }

  info('Two hostnames on a domain you control, and one separate domain for');
  info('preview content. All three zones must already be on Cloudflare.');
  process.stdout.write('\n');

  const appHost = await prompt('App hostname', {
    fallback: state.appHost,
    validate: validHostname,
  });
  const apiHost = await prompt('API hostname', {
    fallback: state.apiHost ?? `api.${appHost}`,
    validate: validHostname,
  });
  const contentDomain = await prompt('Preview content domain', {
    fallback: state.contentDomain,
    validate: validHostname,
  });

  // Uploaded HTML runs on the content domain. If it can set a cookie that the
  // app will send back, origin isolation has been given away.
  if (appHost === contentDomain || appHost.endsWith(`.${contentDomain}`)) {
    fail(
      `${appHost} sits inside ${contentDomain}.`,
      `Uploaded HTML would be able to set cookies for ${contentDomain}, and the browser\n` +
        `would send them to your app. Use a separate domain for preview content.`,
    );
  }

  const shared = sharedSuffix(appHost, contentDomain);
  if (shared.split('.').length >= 2) {
    warn(`${appHost} and ${contentDomain} share the parent domain ${shared}.`);
    detail('Uploaded HTML could set a cookie scoped to it that reaches your app.');
    detail('A separate registrable domain is the only way to close that.');
    if (!(await confirm('Continue anyway?', { fallback: false }))) process.exit(1);
  }

  // Universal SSL stops one level below the apex, and every preview host is one
  // level below the content domain.
  if (contentDomain.split('.').length > 2) {
    warn(`Preview hosts would be <slug>.${contentDomain}, two levels below the apex.`);
    detail('Universal SSL does not reach that far; every preview will fail its TLS');
    detail('handshake unless the zone has Advanced Certificate Manager.');
    if (!(await confirm('Continue anyway?', { fallback: false }))) process.exit(1);
  }

  const next = {
    ...state,
    appHost,
    apiHost,
    contentDomain,
    servicePrefix: servicePrefix ?? state.servicePrefix ?? state.contentPrefix ?? '',
    pagesProject: state.pagesProject ?? 'liha',
  };
  saveState(next);
  return next;
}

async function authenticate() {
  step('Cloudflare credentials');

  let token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (token) {
    detail('Using CLOUDFLARE_API_TOKEN from the environment.');
  } else {
    info('An API token lets this script create DNS records and attach the Pages');
    info('domain for you. Without one it uses `wrangler login` and prints the');
    info('records for you to add by hand.');
    detail('The token is used for this run only. It is never saved.');
    process.stdout.write('\n');
    token = (await promptSecret('API token (input hidden, Enter to skip)')) || undefined;
  }

  if (!token) {
    if (dryRun) {
      planned('wrangler whoami');
      return { mode: 'oauth', api: null, accountId: undefined };
    }
    const check = await wrangler(['whoami'], { cwd: API_DIR, capture: true, allowFailure: true });
    if (check.code !== 0) {
      info('Opening a browser to sign in to Cloudflare.');
      await wrangler(['login'], { cwd: API_DIR });
    }
    done('Signed in through wrangler.');
    warn('No API token, so DNS records are left for you.');
    return { mode: 'oauth', api: null, accountId: undefined };
  }

  if (dryRun) {
    planned('GET /user/tokens/verify');
    return { mode: 'token', api: null, accountId: undefined };
  }

  const api = new CloudflareApi(token);
  try {
    await api.verify();
  } catch (error) {
    fail(
      'That API token was rejected.',
      `${error.message}\n\nCreate one at https://dash.cloudflare.com/profile/api-tokens with:\n` +
        '  Account  Workers Scripts:Edit, Workers R2 Storage:Edit, D1:Edit, Cloudflare Pages:Edit\n' +
        '  Zone     Zone:Read, DNS:Edit, Workers Routes:Edit  (on both zones)',
    );
  }

  const accounts = await api.accounts();
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? accounts[0]?.id;
  if (!accountId) fail('The token can see no accounts.');
  if (accounts.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    process.stdout.write('\n');
    accounts.forEach((account, index) => info(`  ${index + 1}. ${account.name}`));
    const choice = await prompt('Account', {
      fallback: '1',
      validate: (value) =>
        Number(value) >= 1 && Number(value) <= accounts.length
          ? undefined
          : 'Pick one of the above.',
    });
    accountId = accounts[Number(choice) - 1].id;
  }

  done(`Token accepted for ${accounts.find((account) => account.id === accountId)?.name}.`);
  return { mode: 'token', api, accountId, token };
}

/**
 * Finds the zone a hostname belongs to by trying each of its suffixes, longest
 * first. Taking the last two labels would be wrong for anything under a
 * multi-part public suffix such as `example.co.uk`.
 */
async function findZone(api, hostname) {
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const zone = await api.zone(labels.slice(i).join('.'));
    if (zone) return zone;
  }
  return null;
}

async function resolveZones({ api }, config) {
  if (!api) return {};
  step('Zones');

  const zones = {};
  for (const [label, hostname] of [
    ['app', config.appHost],
    ['content', config.contentDomain],
  ]) {
    const zone = await findZone(api, hostname);
    if (!zone) {
      // Listing what the account does have turns "wrong domain" from a guessing
      // game into a choice.
      const available = await api.zones().catch(() => []);
      fail(
        `No zone on this Cloudflare account covers ${hostname}.`,
        (available.length
          ? `This account has:\n${available
              .map(
                (entry) =>
                  `  ${entry.name}${entry.status === 'active' ? '' : ` (${entry.status})`}`,
              )
              .join('\n')}\n\n`
          : '') +
          'Add the domain to Cloudflare and point its nameservers there first.\n' +
          'That part cannot be scripted — it happens at your registrar.',
      );
    }
    if (zone.status !== 'active') {
      fail(`The zone ${zone.name} is "${zone.status}", not active.`, 'Wait for the nameservers.');
    }
    zones[label] = zone;
    done(`${zone.name} (${zone.id.slice(0, 8)})`);
  }
  return zones;
}

async function provisionStorage(env) {
  step('D1 and R2');

  if (dryRun) {
    planned(`wrangler d1 create ${DATABASE_NAME} (if missing)`);
    planned(`wrangler r2 bucket create ${BUCKET_NAME} (if missing)`);
    return 'dry-run-database-id';
  }

  const list = async () =>
    parseJsonOutput(
      (await wrangler(['d1', 'list', '--json'], { cwd: API_DIR, env, capture: true })).stdout,
    );

  let databases = await list();
  if (!databases.some((database) => database.name === DATABASE_NAME)) {
    await wrangler(['d1', 'create', DATABASE_NAME], { cwd: API_DIR, env, capture: true });
    databases = await list();
  }
  const database = databases.find((entry) => entry.name === DATABASE_NAME);
  const databaseId = database?.uuid ?? database?.id;
  if (!databaseId) fail(`Could not find the D1 database ${DATABASE_NAME} after creating it.`);
  done(`D1 ${DATABASE_NAME} (${databaseId.slice(0, 8)})`);

  const bucket = await wrangler(['r2', 'bucket', 'create', BUCKET_NAME], {
    cwd: API_DIR,
    env,
    capture: true,
    allowFailure: true,
  });
  // Creating a bucket that already exists is the normal case on a re-run.
  if (bucket.code !== 0 && !/already (exists|owned)/i.test(bucket.stderr)) {
    fail(`Could not create the R2 bucket.`, bucket.stderr);
  }
  done(`R2 ${BUCKET_NAME}`);

  return databaseId;
}

/**
 * Writes the config the deployment actually uses.
 *
 * The committed `wrangler.toml` holds local development values and stays that
 * way; this file carries your hostnames and is git-ignored. Settings that are
 * properties of the code rather than of a deployment — the entry point, the
 * compatibility date — are read across so the two cannot drift.
 */
function writeGeneratedConfig(config, databaseId, vapidPublicKey) {
  const source = fs.readFileSync(path.join(API_DIR, 'wrangler.toml'), 'utf8');
  const carry = (key) => source.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();

  const contents = [
    '# Generated by scripts/deploy.mjs. Do not edit; re-run the deploy instead.',
    `name = "${WORKER_NAME}"`,
    `main = ${carry('main') ?? '"src/index.ts"'}`,
    `compatibility_date = ${carry('compatibility_date')}`,
    `compatibility_flags = ${carry('compatibility_flags')}`,
    '',
    'routes = [',
    // A custom domain makes wrangler provision this hostname's DNS and
    // certificate itself, which is why the API host never needs a manual record.
    `  { pattern = "${config.apiHost}", custom_domain = true },`,
    `  { pattern = "*.${config.contentDomain}/*", zone_name = "${config.contentDomain}" },`,
    ']',
    '',
    '[vars]',
    `APP_ORIGIN = "https://${config.appHost}"`,
    `API_ORIGIN = "https://${config.apiHost}"`,
    `CONTENT_ORIGIN_TEMPLATE = "https://${config.servicePrefix ?? ''}{label}.${config.contentDomain}"`,
    `REVIEW_ORIGIN_TEMPLATE = "https://${config.servicePrefix ?? ''}{slug}.${config.contentDomain}"`,
    'MAX_VERSION_BYTES = "31457280"',
    'MAX_TOTAL_BYTES = "5368709120"',
    // Notification permission is per origin and every preview has its own, so
    // one origin asks once and its service worker covers all of them.
    `NOTIFICATION_ORIGIN = "https://notification.${config.contentDomain}"`,
    ...(vapidPublicKey ? [`VAPID_PUBLIC_KEY = "${vapidPublicKey}"`] : []),
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${DATABASE_NAME}"`,
    `database_id = "${databaseId}"`,
    'migrations_dir = "migrations"',
    '',
    '[[r2_buckets]]',
    'binding = "BUCKET"',
    `bucket_name = "${BUCKET_NAME}"`,
    '',
    "# The review screen is served from each preview's own hostname, so the",
    '# Worker needs the app bundle. It answers first and decides by hostname:',
    '# a review host gets the app, an artifact host gets the artifact.',
    '[assets]',
    'directory = "../web/dist"',
    'binding = "ASSETS"',
    'run_worker_first = true',
    '',
    '# Samples expire after a day; uploads never do. Hourly, off the hour,',
    "# because that is when everyone else's cron jobs are not running.",
    '[triggers]',
    'crons = ["19 * * * *"]',
    '',
  ].join('\n');

  if (dryRun) {
    planned(`write ${path.relative(ROOT, GENERATED_CONFIG)}`);
    process.stdout.write(`\n${dim}${contents.replace(/^(?=.)/gm, '     ')}${reset}\n`);
    return;
  }
  fs.writeFileSync(GENERATED_CONFIG, contents);
  done(`Wrote ${path.relative(ROOT, GENERATED_CONFIG)}`);
}

async function ensureSigningKey(env) {
  step('Signing key');

  if (dryRun) {
    planned('wrangler secret put CONTENT_SIGNING_KEY (if not already set)');
    return;
  }

  const existing = await wrangler(['secret', 'list', '-c', GENERATED_CONFIG], {
    cwd: API_DIR,
    env,
    capture: true,
    allowFailure: true,
  });
  if (existing.code === 0 && existing.stdout.includes('CONTENT_SIGNING_KEY')) {
    // Rotating it would invalidate every outstanding content grant, so a
    // re-deploy leaves a key that is already there alone.
    done('CONTENT_SIGNING_KEY already set; left as it is.');
    return;
  }

  await wrangler(['secret', 'put', 'CONTENT_SIGNING_KEY', '-c', GENERATED_CONFIG], {
    cwd: API_DIR,
    env,
    capture: true,
    input: crypto.randomBytes(32).toString('base64'),
  });
  done('Generated and stored CONTENT_SIGNING_KEY.');
}

/**
 * The VAPID keypair that identifies this deployment to push services.
 *
 * Generated once and kept. The public key is what browsers subscribe with, so
 * replacing it silently invalidates every subscription anyone has made — which
 * is why this never regenerates over an existing key, and why the public half
 * lives in the deploy state rather than being derived at deploy time.
 *
 * Only the private half is a secret. The public half is meant to be published.
 */
async function ensureVapidKeys(env, state) {
  step('Notification signing key');

  if (dryRun) {
    planned('wrangler secret put VAPID_PRIVATE_KEY (if not already set)');
    return state.vapidPublicKey ?? 'DRY-RUN-PLACEHOLDER';
  }

  const existing = await wrangler(['secret', 'list', '-c', GENERATED_CONFIG], {
    cwd: API_DIR,
    env,
    capture: true,
    allowFailure: true,
  });
  const hasSecret = existing.code === 0 && existing.stdout.includes('VAPID_PRIVATE_KEY');

  if (hasSecret && state.vapidPublicKey) {
    done('VAPID keys already set; left as they are.');
    return state.vapidPublicKey;
  }
  if (hasSecret !== Boolean(state.vapidPublicKey)) {
    // One half without the other cannot work, and quietly minting a new pair
    // would turn every existing subscription into silence.
    detail('Only half of the VAPID keypair was found; generating a new pair.');
    detail('Anyone already subscribed will have to allow notifications again.');
  }

  // Same shapes as generateVapidKeys() in apps/api/src/push.ts: the public key
  // is the raw uncompressed point, base64url; the private key is a JWK.
  const pair = await crypto.webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const raw = Buffer.from(await crypto.webcrypto.subtle.exportKey('raw', pair.publicKey));
  const publicKey = raw.toString('base64url');
  const privateKeyJwk = JSON.stringify(
    await crypto.webcrypto.subtle.exportKey('jwk', pair.privateKey),
  );

  await wrangler(['secret', 'put', 'VAPID_PRIVATE_KEY', '-c', GENERATED_CONFIG], {
    cwd: API_DIR,
    env,
    capture: true,
    input: privateKeyJwk,
  });
  done('Generated and stored a VAPID keypair.');
  return publicKey;
}

async function deployWorker(env) {
  step('Database migrations and the Worker');

  if (dryRun) {
    planned(`wrangler d1 migrations apply ${DATABASE_NAME} --remote`);
    planned('wrangler deploy');
    return;
  }

  await wrangler(
    ['d1', 'migrations', 'apply', DATABASE_NAME, '--remote', '-c', GENERATED_CONFIG],
    // Detaching stdin puts wrangler on its non-interactive path, so this does
    // not stop to ask for a confirmation in the middle of a deploy.
    { cwd: API_DIR, env, silentStdin: true },
  );
  done('Migrations applied.');

  await wrangler(['deploy', '-c', GENERATED_CONFIG], { cwd: API_DIR, env });
  done('Worker deployed.');
}

async function configureDns({ api }, config, zones) {
  step('DNS');

  const wildcard = {
    type: 'A',
    name: `*.${config.contentDomain}`,
    content: PLACEHOLDER_ADDRESS,
    proxied: true,
    comment: 'Liha preview content; answered by the Worker route.',
  };

  if (dryRun) {
    planned(`upsert ${wildcard.type} ${wildcard.name} -> ${wildcard.content} (proxied)`);
    planned(`upsert CNAME ${config.appHost} -> ${config.pagesProject}.pages.dev (proxied)`);
    return;
  }

  if (!api) {
    warn('No API token, so these are yours to add:');
    callout([
      `${bold}${config.contentDomain}${reset} zone:`,
      `  A      *          ${PLACEHOLDER_ADDRESS}   Proxied`,
      '',
      `${bold}${config.appHost}${reset}:`,
      `  CNAME  ${config.appHost.split('.')[0]}  ${config.pagesProject}.pages.dev   Proxied`,
      '',
      `${dim}The API host needs nothing — wrangler made it a custom domain.${reset}`,
    ]);
    return;
  }

  const outcome = await api.upsertDnsRecord(zones.content.id, wildcard);
  done(`${wildcard.name} ${outcome}.`);
}

/**
 * Built before the Worker is deployed, because the Worker carries this bundle
 * for the review-screen hostnames.
 */
async function buildWebApp(config) {
  step('Web app bundle');

  const apiOrigin = `https://${config.apiHost}`;
  if (dryRun) {
    planned(`VITE_API_URL=${apiOrigin} pnpm --filter @liha/web build`);
    planned(`write apps/web/dist/_headers for ${apiOrigin} and *.${config.contentDomain}`);
    return;
  }

  await run('pnpm', ['--filter', '@liha/web', 'build'], { env: { VITE_API_URL: apiOrigin } });

  // Written after the build so the placeholders in public/_headers can never
  // reach a deployment. This is the landing page's policy; the review screen
  // gets its own from the Worker, which knows the preview's own origin.
  fs.writeFileSync(
    path.join(WEB_DIST, '_headers'),
    buildHeaders({ apiOrigin, contentDomain: config.contentDomain }),
  );
  done('Built, with a Content-Security-Policy naming your own hosts.');
}

async function deployWebApp(config, { api, accountId }, zones, env) {
  step('Landing page');

  if (dryRun) {
    planned(`wrangler pages project create ${config.pagesProject} (if missing)`);
    planned(`wrangler pages deploy apps/web/dist --project-name ${config.pagesProject}`);
    planned(`attach ${config.appHost} to the Pages project`);
    return;
  }

  // Create and tolerate the conflict, rather than listing first. `wrangler pages
  // project list --json` keys its objects "Project Name", while `d1 list --json`
  // uses "name" — so reading the list means depending on a shape that differs
  // between commands and can change under us. Creating says what happened.
  const project = await wrangler(
    ['pages', 'project', 'create', config.pagesProject, '--production-branch', 'main'],
    { cwd: API_DIR, env, capture: true, allowFailure: true },
  );
  if (project.code === 0) {
    done(`Created the Pages project ${config.pagesProject}.`);
  } else if (/already exists/i.test(project.stderr)) {
    done(`Pages project ${config.pagesProject} already exists.`);
  } else {
    fail('Could not create the Pages project.', project.stderr);
  }

  await wrangler(
    [
      'pages',
      'deploy',
      WEB_DIST,
      '--project-name',
      config.pagesProject,
      '--branch',
      'main',
      '--commit-dirty',
      'true',
    ],
    { cwd: API_DIR, env },
  );
  done('Pages deployment uploaded.');

  if (!api) return;

  const domains = await api.pagesDomains(accountId, config.pagesProject);
  if (!domains.some((domain) => domain.name === config.appHost)) {
    await api.addPagesDomain(accountId, config.pagesProject, config.appHost);
    done(`Attached ${config.appHost} to the project.`);
  }
  const outcome = await api.upsertDnsRecord(zones.app.id, {
    type: 'CNAME',
    name: config.appHost,
    content: `${config.pagesProject}.pages.dev`,
    proxied: true,
    comment: 'Liha web app.',
  });
  done(`${config.appHost} ${outcome}.`);
}

/** Certificates and DNS take a moment; a fresh deployment 5xxs until they land. */
async function waitForHealth(config) {
  step('Waiting for the deployment to answer');

  if (dryRun) {
    planned(`poll https://${config.apiHost}/api/health`);
    return true;
  }

  const deadline = Date.now() + 5 * 60_000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const response = await fetch(`https://${config.apiHost}/api/health`);
      if (response.ok) {
        done(`https://${config.apiHost} is up.`);
        return true;
      }
    } catch {
      // Not resolvable or not certified yet; both resolve themselves.
    }
    if (Date.now() > deadline) {
      warn('Still not answering after five minutes.');
      detail('A new certificate can take longer. Try the verification again later:');
      detail(
        `  pnpm verify:deployment --api https://${config.apiHost} --app https://${config.appHost}`,
      );
      return false;
    }
    if (attempt % 6 === 0) detail(`still waiting (${attempt * 5}s)`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function verify(config) {
  step('Verifying from the outside');

  const script = path.join(ROOT, 'scripts', 'verify-deployment.mjs');
  const args = [script, '--api', `https://${config.apiHost}`, '--app', `https://${config.appHost}`];

  if (dryRun) {
    planned(`node ${['scripts/verify-deployment.mjs', ...args.slice(1)].join(' ')}`);
    return true;
  }

  const result = await run(process.execPath, args, { allowFailure: true });
  return result.code === 0;
}

// ------------------------------------------------------------------- driver

process.stdout.write(`\n${bold}Deploying Liha to Cloudflare${reset}\n`);
if (dryRun) detail('Dry run: nothing is created, uploaded or changed.');

const previousState = readState();
const config = await collectConfiguration(previousState);
const auth = await authenticate();
closeInput();

// Everything wrangler runs inherits the credentials this way rather than
// through argv, where other processes on the machine could read them.
const env = {
  ...(auth.token ? { CLOUDFLARE_API_TOKEN: auth.token } : {}),
  ...(auth.accountId ? { CLOUDFLARE_ACCOUNT_ID: auth.accountId } : {}),
};

const zones = await resolveZones(auth, config);
const databaseId = await provisionStorage(env);

step('Configuration');
writeGeneratedConfig(config, databaseId);

await ensureSigningKey(env);
// The public half is a plain var, so the config is written again now that it
// is known. The first write is what lets wrangler talk to this Worker at all.
const vapidPublicKey = await ensureVapidKeys(env, previousState);
writeGeneratedConfig(config, databaseId, vapidPublicKey);
await buildWebApp(config);
await deployWorker(env);
await configureDns(auth, config, zones);
await deployWebApp(config, auth, zones, env);

const healthy = await waitForHealth(config);
const verified = healthy ? await verify(config) : false;

saveState({ ...config, vapidPublicKey, lastDeployedAt: new Date().toISOString() });

process.stdout.write(`\n${bold}${dryRun ? 'Plan complete.' : 'Done.'}${reset}\n\n`);
if (!dryRun) {
  info(`App        https://${config.appHost}`);
  info(`API        https://${config.apiHost}`);
  info(`Reviews    https://${config.servicePrefix ?? ''}<slug>.${config.contentDomain}`);
  info(`Artifacts  https://${config.servicePrefix ?? ''}<slug>--<version>.${config.contentDomain}`);
  process.stdout.write('\n');
  info('Try it:');
  detail(`  LIHA_API_URL=https://${config.apiHost} liha-preview deploy ./some-site`);
  process.stdout.write('\n');
  info('Then, for WebMCP in stock Chrome, register the app origin for the');
  info('origin trial and paste the token into apps/web/index.html:');
  detail('  https://developer.chrome.com/origintrials');
}

if (!verified && !dryRun) {
  process.exitCode = 1;
}
