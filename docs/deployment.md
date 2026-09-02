# Deploying Liha

Liha runs entirely on Cloudflare. Nothing else is hosted:

| Piece           | Cloudflare product                   |
| --------------- | ------------------------------------ |
| API             | Workers (Hono)                       |
| Preview content | the same Worker, on a wildcard route |
| Metadata        | D1                                   |
| Artifacts       | R2                                   |
| Web app         | Pages (static bundle)                |

The CLI and the MCP server are not hosted at all — they run on the developer's
own machine, and talk to your API over HTTPS.

## Before you start

You need a Cloudflare account and **two domains**, both already added to it with
their nameservers pointed at Cloudflare. That part happens at your registrar and
cannot be scripted; everything after it can.

|               | Example                      | Served by |
| ------------- | ---------------------------- | --------- |
| Landing       | `liha.example.com`           | Pages     |
| API           | `api.liha.example.com`       | Worker    |
| Review screen | `lp-<slug>.example.net`      | Worker    |
| Artifact      | `lp-<slug>--<n>.example.net` | Worker    |

The second domain is where everything a stranger uploaded is served, and it
carries both the review screen and the artifact. Two reasons to keep it separate
from the one your other services use:

- **Reputation.** A malicious upload can get a domain onto a blocklist. When
  that happens you want the damage to stop at a domain you use for nothing else.
- **Cookies.** Uploaded HTML on `x.example.net` can set a cookie scoped to
  `.example.net`. On a shared domain that cookie would reach your app.

Within that domain the review screen and the artifact are **siblings**, not
parent and child: `lp-abc123.example.net` and `lp-abc123--1.example.net`. They
have to be different origins — the review screen holds the owner token in
`localStorage`, and uploaded HTML must not be able to read it — and they have to
be one level under the apex, because Cloudflare's Universal SSL covers
`example.net` and `*.example.net` but not `*.preview.example.net`. Put either
any deeper and every preview fails its TLS handshake until you add [Advanced
Certificate
Manager](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)
(paid). Proxied wildcard DNS records themselves are available on every plan.

The `lp-` prefix is this service's slice of that domain, set with
`--service-prefix lp-`. The Worker holds the whole wildcard, because Cloudflare
cannot route on anything narrower, and answers only for hostnames it recognises
— so the same domain can carry other services under other prefixes. On a domain
this deployment has to itself, the prefix can be empty.

The deploy script refuses to put previews inside your app's own domain, and
warns before a domain deep enough that the certificate will not reach.

## The short way

```bash
pnpm run deploy
```

It asks for the three hostnames and for a Cloudflare credential, then does the
rest: creates the D1 database and the R2 bucket, writes a generated Wrangler
config, applies the migrations, deploys the Worker, adds the wildcard DNS
record, builds the web app with a Content-Security-Policy naming your own hosts,
deploys it to Pages, attaches the custom domain, waits for the certificate, and
finishes by running the fifteen outside-in checks described under
[Checking it](#checking-it).

See the whole plan without touching anything:

```bash
pnpm run deploy --dry-run
```

Re-running is safe. Every step looks before it creates, and an existing
`CONTENT_SIGNING_KEY` is left alone rather than rotated — rotating it would
invalidate every outstanding content grant. Your answers are remembered in
`.liha/deploy.json` (git-ignored); `--reconfigure` asks again.

> `pnpm deploy` without `run` is pnpm's own built-in command, not this script.

### Credentials

You have two options, and the script offers both:

- **An API token** (paste it at the prompt, or set `CLOUDFLARE_API_TOKEN`). This
  is the complete path: the script can also create DNS records and attach the
  Pages domain. Create one at
  [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
  with **Account**: Workers Scripts:Edit, Workers R2 Storage:Edit, D1:Edit,
  Cloudflare Pages:Edit; and **Zone**: Zone:Read, DNS:Edit, Workers Routes:Edit
  on both zones.
- **`wrangler login`** (press Enter to skip the token). Everything still
  deploys, but wrangler's OAuth scopes do not include DNS, so the script prints
  the one or two records for you to add.

The token is used for that one run. It is never written to disk, never stored in
the saved configuration, and never passed as a command-line argument — it
reaches wrangler through the environment.

### What it will not do

- Register domains, or move nameservers to Cloudflare.
- Buy Advanced Certificate Manager.
- Register the Chrome origin trial (see
  [WebMCP in a real agent browser](#webmcp-in-a-real-agent-browser)).

## Doing it by hand

The script is a convenience, not a dependency. The same deployment, step by
step:

### Create the resources

```bash
wrangler login

wrangler d1 create liha-live-preview
wrangler r2 bucket create liha-live-preview
```

Copy the printed `database_id` into `apps/api/wrangler.toml`.

### Point the Worker at your origins

In `apps/api/wrangler.toml`:

```toml
[vars]
APP_ORIGIN = "https://liha.example.com"
API_ORIGIN = "https://api.liha.example.com"
REVIEW_ORIGIN_TEMPLATE = "https://lp-{slug}.example.net"
CONTENT_ORIGIN_TEMPLATE = "https://lp-{label}.example.net"
MAX_VERSION_BYTES = "31457280"
MAX_TOTAL_BYTES = "5368709120"
```

`{slug}` and `{label}` (which is `<slug>--<version>`) are replaced; `{version}`
also works, so `https://lp-{slug}-v{version}.example.net` is equally valid if a
shared domain already has a convention to fit. A slug never contains a hyphen,
so the review and artifact patterns cannot be confused for each other.

`API_ORIGIN` exists because the review screen has to name the API in its own
Content-Security-Policy, and it cannot work that out from a hostname that
belongs to a preview. Leave it out only when the API and the app share an
origin.

The Worker serves the app bundle for review hostnames, so it needs it:

```toml
[assets]
directory = "../web/dist"
binding = "ASSETS"
run_worker_first = true
```

Build the web app before deploying the Worker, or there is nothing to attach.

Add the routes so the Worker answers on both the API host and everything on the
preview domain. Note the two different zones:

```toml
routes = [
  { pattern = "api.liha.example.com", custom_domain = true },
  { pattern = "*.example.net/*", zone_name = "example.net" },
]
```

One wildcard covers review screens and artifacts alike; the Worker tells them
apart by hostname, and answers for nothing else on that domain.

`custom_domain` makes wrangler provision that hostname's DNS record and
certificate itself. The wildcard cannot be a custom domain, so it needs one
proxied record of its own on the content zone:

```
Type  Name  Content      Proxy
A     *     192.0.2.1    Proxied
```

The address is never reached — the Worker route answers at the edge — but the
record has to exist for the hostname to resolve and be proxied.

The committed `wrangler.toml` holds the _local_ values (`http://localhost:5173`
and `*.localhost`). Deploying without editing this section produces a Worker
that mints share URLs pointing at your laptop.

### Migrate and deploy

```bash
openssl rand -base64 32 | wrangler secret put CONTENT_SIGNING_KEY

pnpm --filter liha-api db:migrate:remote
pnpm --filter liha-api deploy

curl https://api.liha.example.com/api/health
```

### Deploy the web app

```bash
VITE_API_URL=https://api.liha.example.com pnpm --filter liha-web build
wrangler pages deploy apps/web/dist --project-name liha
```

`_headers` in `apps/web/public` sets the **landing page's**
Content-Security-Policy — review screens are served by the Worker, which builds
its own from the origins it knows. Pages applies this file as-is. It ships with
the same placeholders used above, so edit
two directives to match your own hosts before that first deploy:

```
connect-src 'self' https://api.liha.example.com
frame-src https://*.example.net
```

Leave the placeholders in and the app loads but does nothing: every API call and
every preview iframe is blocked by CSP. The verification below checks for
exactly this. (`pnpm run deploy` generates this file from your answers, so a
scripted deployment cannot ship the placeholders.)

Pages serves `index.html` for unmatched paths, so `/p/<slug>` on the landing
domain survives a reload without any `_redirects` file. Those links keep working
after review screens move to their own hostnames, so nothing already sent
breaks.

## Checking it

```bash
pnpm verify:deployment --api https://api.liha.example.com --app https://liha.example.com
```

Fifteen checks against the live instance. It creates a sample preview,
exercises it, and deletes it again, exiting non-zero on any failure so it can
gate a deploy. `pnpm run deploy` finishes by running it for you.

Most of them are about the seams a deployment can get wrong while every test
still passes, because the dev server the test suite runs against sends no
Content-Security-Policy and knows nothing about your hostnames:

- The share URL leads to a page that serves the app and knows which preview it
  is, on an origin that is not the artifact's.
- That page may call the API — both CORS on the API and `connect-src` on the
  page, which fail identically from outside.
- It may read the artifact, which pdf.js and `read_artifact_file` both need.
- `img-src` and `frame-src` reach the artifact, or images and HTML render as
  nothing while the other kind works.
- The artifact carries its sandbox headers, root-absolute assets resolve, and
  path traversal is refused.
- The whole comment, reply, resolve loop.

Each of those was written after watching it fail against a real deployment.

Then, by hand:

```bash
LIHA_API_URL=https://api.liha.example.com liha-preview deploy ./some-site
```

Open the printed share URL and confirm:

- the artifact renders inside the iframe
- clicking an element opens the composer with a selector
- a comment saves and appears in the sidebar
- `liha-preview comments --json` returns it

## WebMCP in a real agent browser

Open the share URL in **ChatGPT's in-app browser** (Site tools require GPT-5.6
Sol or Terra, and are unavailable in Enterprise and Edu workspaces) and ask:

> What review feedback is open on this preview, and what does it point at?

You should see it call the Liha tools and answer with the selector. Then:

> Reply to that comment saying the padding will be reduced to 16px.

The reply must appear in the sidebar without a reload.

The **Agent tools** button in the top bar reports whether WebMCP was detected,
on which global, and in which registration style — start there if something
looks wrong. `packages/webmcp/src/register.ts` is the only file that touches the
browser API.

For stock Chrome, register the app origin for the
[WebMCP origin trial](https://developer.chrome.com/origintrials) and paste the
token into the commented-out `<meta http-equiv="origin-trial">` in
`apps/web/index.html`. Without it, users need
`chrome://flags/#enable-webmcp-testing`.

## The sample path

The home page's **"Open a sample review"** button mints a real preview seeded
with anchored feedback. It is the fastest way to confirm a fresh deployment is
working end to end, and the first thing a new visitor will press.
