# Architecture

## The shape of the problem

A reviewer looks at a rendered artifact and says "this button is too big". That
sentence is useless to an agent on its own. What makes it actionable is
everything around it: which element, on which page, at which viewport, on which
version of the build.

Liha's job is to capture that context at the moment of the click, keep it
attached to an immutable version, and hand it to an agent in a structured form.
Everything else — storage, versioning, auth — exists to make that possible
without requiring a login.

## Components

| Package                  | Runtime                | Responsibility                                                                                                                    |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@liha-cli/shared`       | Workers, Node, browser | Zod schemas, ids and slugs, token/password crypto, path sanitizing, SSRF validation. The security-critical code lives here, once. |
| `liha-api`               | Cloudflare Workers     | JSON API and sandboxed content serving.                                                                                           |
| `liha-web`               | Browser                | Review UI, annotation layer, WebMCP host.                                                                                         |
| `@liha-cli/webmcp`       | Browser                | `document.modelContext` tool definitions. No framework dependency.                                                                |
| `@liha-cli/mcp`          | Node                   | stdio MCP server, plus the credential store both local tools share.                                                               |
| `@liha-cli/live-preview` | Node                   | The `liha-preview` CLI.                                                                                                           |

## Ports at the infrastructure boundary

`apps/api/src/ports.ts` declares two interfaces — `Database` and `ObjectStore` —
that are _structural subsets_ of Cloudflare's D1 and R2 bindings. The real
bindings satisfy them with no adapter.

This buys two things:

1. **Tests run the real SQL.** `apps/api/test/harness.ts` binds the same routes
   to `node:sqlite`, applying the same migration files that ship. An integration
   test that creates a preview, comments on it and publishes a version runs in
   about 20 ms, and still catches a broken query.
2. **The route code has no runtime-specific branches.** There is one code path,
   and Workers runs it.

The Workers entry (`src/index.ts`) is deliberately trivial; everything is in
`handleRequest`.

## Three origins

```
landing                    review screen              artifact
https://liha.example       https://lp-<slug>.review   https://lp-<slug>--<n>.review
  ├── the app                ├── the same app           └── uploaded HTML, CSS,
  └── creates previews       ├── owner token in             JS, images, PDFs
                             │   localStorage
                             └── review session token
```

Uploaded HTML is untrusted code. Rather than trying to sanitize it, we run it
somewhere it cannot do damage: a different origin, inside an iframe with
`sandbox` and no `allow-same-origin`. The browser's same-origin policy does the
enforcement.

The slug and version number are part of the **hostname**, not a path prefix.
None of that is cosmetic:

- Bundlers emit root-absolute asset paths (`/assets/app.js`). Under a path mount
  those 404. Under a host mount they resolve.
- Switching versions is a different origin, so a stale service worker or cache
  from v1 cannot affect v2.
- A preview owns its whole origin, so any path under it is that preview's review
  screen. Sub-pages of a review would otherwise collide with the artifact's own
  paths.
- The owner token is kept in `localStorage`, which is scoped to an origin, so
  holding one preview does not imply holding another.

The review screen and the artifact are siblings one level under the same apex, so
a single wildcard certificate covers both while they stay different origins. The
`lp-` prefix is this service's slice of a domain that may carry others: the
Worker takes the whole wildcard, because Cloudflare cannot route on anything
narrower, and leaves hostnames it does not recognise alone rather than claiming
them.

Three things have to line up for a review screen to work, and each fails the
same way from outside — a page that loads and then cannot do something:

| The app does                | Which needs                              |
| --------------------------- | ---------------------------------------- |
| calls the API               | CORS on the API, `connect-src` on itself |
| shows an HTML artifact      | `frame-src`                              |
| shows an image              | `img-src`                                |
| renders a PDF, reads source | `connect-src`, and CORS on the artifact  |

`scripts/verify-deployment.mjs` makes each of those calls from the origin the
app makes it from. The end-to-end suite cannot: the dev server sends no policy.

A path-mounted fallback (`/content/:slug/:version/*`) exists for deployments
without wildcard DNS. It resolves root-absolute assets by inspecting the
`Referer`, which works but is not origin-isolated — see
[security.md](security.md).

## The review bridge

For HTML previews, the API injects a small script into every served HTML
document (`apps/api/src/bridge.ts`). It is the only channel between the
sandboxed artifact and the app.

```
app                                          preview iframe
 │  postMessage {source:"liha-app",           │
 │               type:"set-mode",             │
 │               mode:"review"}   ──────────► │  starts hover highlight,
 │                                            │  intercepts clicks
 │                                            │
 │  ◄────────── postMessage {source:"liha-    │  on click: computes a unique
 │              bridge", type:"element-       │  selector, ancestor path, text,
 │              picked", element, point,      │  HTML snippet, bounding rect,
 │              metrics}                      │  normalized document position
 │                                            │
 │  ◄────────── {type:"metrics"}  on scroll   │  so overlays stay aligned
```

Because the iframe has an opaque origin, `event.origin` is always `"null"` and
useless for authentication. Identity is established by comparing `event.source`
against the exact `contentWindow` the app created — a reference no other
document can forge. The child performs the mirror check against `window.parent`.

The bridge is inert until the app puts it in review mode, and it never accepts
anything from the parent except display commands.

## Coordinates

Annotations are stored normalized to `0..1`, never in pixels:

- **Images and PDF pages** normalize against the rendered box.
- **HTML documents** normalize against the full scroll size, and the bridge
  reports scroll offsets so the app's overlay can re-project on every scroll.

A pin dropped on a 1280px-wide desktop view therefore lands in the same place
when the same version is opened on a phone.

`apps/web/src/lib/projection.ts` holds both projections; they are pure functions
and unit-tested.

## Data model

```
previews ──┬── versions (immutable, numbered from 1)
           ├── comments (recorded against the version they were left on)
           ├── review_sessions (short-lived, password-protected previews)
           └── auth_attempts (sliding window for the brute-force limiter)
```

`previews.current_version_id` is the only mutable pointer, and it is what the
share URL follows. Publishing a version writes new rows; restoring an old
version moves the pointer. Nothing is overwritten, so a comment left on v1
remains meaningful after v4 ships — it is just flagged `stale: true`.

R2 keys are `previews/{previewId}/versions/{versionId}/files/{sanitized path}`,
plus a `manifest.json` per version. The manifest is also stored in D1 so serving
a file needs one database read and one object read, and so an unknown path is
rejected before touching storage.

## Request flow: serving a preview file

1. `handleRequest` checks the `Host` against `CONTENT_ORIGIN_TEMPLATE`; a match
   yields `{ slug, versionNumber }`.
2. Look up the preview and that version.
3. If password-protected, verify the signed content grant in `?t=`; it must name
   this preview _and_ this version.
4. Decode the path exactly once, sanitize it, and check it against the
   manifest's file list. Unknown paths fall back to `index.html` only for
   extension-less paths (SPA routing).
5. Read from R2, serve with the manifest's recorded content type, `nosniff`,
   `Referrer-Policy: no-referrer` and a `CSP: sandbox` header.
6. If it is HTML, inject the bridge.

## Why ownership does not require a login

Ownership is a 256-bit owner token, shown once, stored hashed. The CLI and MCP
server keep it in `~/.config/liha/config.json`; the browser keeps it in
`localStorage` for the app origin only. A reviewer needs nothing at all: the
share link is the credential to comment.

An account exists and is never required. Every visitor gets an anonymous
account the first time they act; signing in with Google links that same account
so what you own and review follows you to other browsers, and lengthens how long
a preview is kept (a week anonymously, a month signed in). The "my previews"
list at `/me` works either way. What sign-in does not do is gate anything: no
tool, no comment, no review screen asks for it.

The cost that remains is that an owner token cannot be rotated. That is a
deliberate trade for a product whose point is the feedback loop, not identity.
