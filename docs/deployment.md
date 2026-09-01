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

|                 | Example                | Notes                                                     |
| --------------- | ---------------------- | --------------------------------------------------------- |
| App             | `liha.example.com`     | The review UI (Pages)                                     |
| API             | `api.liha.example.com` | The Worker                                                |
| Preview content | `*.example.net`        | **A second, dedicated domain.** See below — this matters. |

Preview content must live on a **different registrable domain** from the app,
not merely a different hostname. A sibling subdomain is not enough: uploaded
HTML on `abc.example.com` can set a cookie scoped to `.example.com`, and that
cookie reaches your app. A separate domain makes that impossible.

Using a second domain also keeps the certificate free. Cloudflare's Universal
SSL covers the apex and **one** level of subdomain — `example.net` and
`*.example.net`, but not `*.preview.example.net`. Preview hosts look like
`abc123--1.example.net`, which is exactly one level down, so Universal SSL
covers them. Put the wildcard any deeper and every preview fails its TLS
handshake until you add [Advanced Certificate
Manager](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)
(paid). Proxied wildcard DNS records themselves are available on every plan.

The deploy script refuses the first arrangement and warns about the second, so
you do not have to hold this in your head.

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
CONTENT_ORIGIN_TEMPLATE = "https://{label}.example.net"
MAX_VERSION_BYTES = "31457280"
MAX_TOTAL_BYTES = "5368709120"
```

Add the routes so the Worker answers on both the API host and every preview
host. Note the two different zones:

```toml
routes = [
  { pattern = "api.liha.example.com", custom_domain = true },
  { pattern = "*.example.net/*", zone_name = "example.net" },
]
```

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

pnpm --filter @liha/api db:migrate:remote
pnpm --filter @liha/api deploy

curl https://api.liha.example.com/api/health
```

### Deploy the web app

```bash
VITE_API_URL=https://api.liha.example.com pnpm --filter @liha/web build
wrangler pages deploy apps/web/dist --project-name liha
```

`_headers` in `apps/web/public` sets the app's Content-Security-Policy, and
Pages applies it as-is. It ships with the same placeholders used above, so edit
two directives to match your own hosts before that first deploy:

```
connect-src 'self' https://api.liha.example.com
frame-src https://*.example.net
```

Leave the placeholders in and the app loads but does nothing: every API call and
every preview iframe is blocked by CSP. The verification below checks for
exactly this. (`pnpm run deploy` generates this file from your answers, so a
scripted deployment cannot ship the placeholders.)

Pages serves `index.html` for unmatched paths, so share URLs like `/p/<slug>`
survive a reload without any `_redirects` file.

## Checking it

```bash
pnpm verify:deployment --api https://api.liha.example.com --app https://liha.example.com
```

Fifteen checks against the live instance: CORS, that the app's own CSP permits
its API and content hosts, that preview content really is on a separate origin,
that the wildcard host resolves and serves the artifact with its sandbox
headers, that root-absolute assets resolve, that path traversal is refused, and
the whole comment/reply/resolve loop. It creates a sample preview and deletes it
again, and exits non-zero on any failure, so it can gate a deploy.
`pnpm run deploy` finishes by running it for you.

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
