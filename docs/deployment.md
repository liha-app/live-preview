# Deploying Liha

Liha runs entirely on Cloudflare: a Worker for the API and content serving, D1
for metadata, R2 for artifacts, and any static host for the web app.

You need a Cloudflare account and a domain you control. The one part that is
easy to get wrong is the **wildcard content origin** — read step 1 before
starting.

## 1. Pick your hostnames

You need two, on a domain you control:

|                 | Example                      | Notes                                                                                                    |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| App             | `liha.example.com`           | The review UI (Cloudflare Pages)                                                                         |
| API             | `api.liha.example.com`       | The Worker                                                                                               |
| Preview content | `*.preview-liha.example.com` | **Wildcard.** Must not be a parent of the app domain, so cookies can never be shared with uploaded HTML. |

The wildcard needs a DNS record and a certificate. On Cloudflare, a proxied
`*` CNAME plus Universal SSL covers one level of subdomain, which is all we use.

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
CONTENT_ORIGIN_TEMPLATE = "https://{label}.preview-liha.example.com"
MAX_VERSION_BYTES = "52428800"
```

Add the routes so the Worker answers on both the API host and every preview host:

```toml
routes = [
  { pattern = "api.liha.example.com/*", zone_name = "example.com" },
  { pattern = "*.preview-liha.example.com/*", zone_name = "example.com" },
]
```

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

Then update `apps/web/public/_headers` so `connect-src` names your API host and
`frame-src` names your wildcard content host, and redeploy. The file ships with
`example.com` placeholders; leaving them in place will break the app under CSP.

## 6. Smoke test the deployment

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
