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

You need a Cloudflare account and **two domains**. The one part that is easy to
get wrong is the wildcard content origin — read step 1 before starting.

## 1. Pick your hostnames

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

So, on the content zone, create one proxied wildcard record:

```
Type  Name  Content        Proxy
A     *     192.0.2.1      Proxied
```

The address is never used — the Worker route below answers first — but the
record has to exist for the hostname to resolve and be proxied.

## 2. Create the resources

```bash
wrangler login

wrangler d1 create liha-live-preview
wrangler r2 bucket create liha-live-preview
```

Copy the printed `database_id` into `apps/api/wrangler.toml`.

## 3. Point the Worker at your origins

In `apps/api/wrangler.toml`:

```toml
[vars]
APP_ORIGIN = "https://liha.example.com"
CONTENT_ORIGIN_TEMPLATE = "https://{label}.example.net"
MAX_VERSION_BYTES = "52428800"
```

Add the routes so the Worker answers on both the API host and every preview
host. Note the two different zones:

```toml
routes = [
  { pattern = "api.liha.example.com/*", zone_name = "example.com" },
  { pattern = "*.example.net/*", zone_name = "example.net" },
]
```

The committed `wrangler.toml` holds the _local_ values (`http://localhost:5173`
and `*.localhost`). Deploying without editing this section produces a Worker
that mints share URLs pointing at your laptop, so change it before step 4.

## 4. Migrate and deploy

```bash
openssl rand -base64 32 | wrangler secret put CONTENT_SIGNING_KEY

pnpm --filter @liha/api db:migrate:remote
pnpm --filter @liha/api deploy
```

Check it:

```bash
curl https://api.liha.example.com/api/health
```

## 5. Deploy the web app

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
every preview iframe is blocked by CSP. Step 6 checks for exactly this.

Pages serves `index.html` for unmatched paths, so share URLs like
`/p/<slug>` survive a reload without any `_redirects` file.

## 6. Smoke test the deployment

```bash
pnpm verify:deployment --api https://api.liha.example.com --app https://liha.example.com
```

Fifteen checks against the live instance: CORS, that the app's own CSP permits
its API and content hosts, that preview content really is
on a separate origin, that the wildcard host resolves and serves the artifact
with its sandbox headers, that root-absolute assets resolve, that path traversal
is refused, and the whole comment/reply/resolve loop. It creates a sample
preview and deletes it again, and exits non-zero on any failure, so it can gate
a deploy.

Then, by hand:

```bash
LIHA_API_URL=https://api.liha.example.com liha-preview deploy ./some-site
```

Open the printed share URL and confirm:

- the artifact renders inside the iframe
- clicking an element opens the composer with a selector
- a comment saves and appears in the sidebar
- `liha-preview comments --json` returns it

## 7. Check the WebMCP tools in a real agent browser

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

## 8. Confirm the sample path

The home page's **"Open a sample review"** button mints a real preview seeded
with anchored feedback. It is the fastest way to confirm a fresh deployment is
working end to end, and the first thing a new visitor will press.
