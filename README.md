# Liha Live Preview

_English · [日本語](README.ja.md)_

[![CI](https://github.com/liha-app/live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/liha-app/live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Share a build, a mockup or a document at a stable URL. People mark up what they
see. An AI agent reads that feedback **with structured context** — the CSS
selector, the DOM snippet, the page, the viewport — fixes the source, and ships
a new version to the same link.

The interesting part is not the file sharing. It is that a human pointing at a
button on screen becomes something an agent can act on without anyone copying
and pasting anything.

```
liha-preview deploy .          →  https://liha.example/p/qxp3z4yqu5ow

   reviewer clicks the hero button and writes "make this smaller"
                    ↓
   agent: list_comments → get_comment → edits source → update_preview → resolve_comment
                    ↓
   same URL, version 2, comment resolved
```

- **MIT licensed**, no accounts, no billing, no SaaS.
- **Light and dark themes**, **English and Japanese**, keyboard-driven, zero WCAG 2.1 AA violations.
- Runs on **Cloudflare Workers + D1 + R2**, and entirely locally with Wrangler.
- **WebMCP** tools in the browser, a **local MCP server** for coding agents, and
  a **CLI** with `--json` on everything.

---

## Table of contents

- [What is Liha Live Preview?](#what-is-liha-live-preview)
- [Architecture](#architecture)
- [Local development](#local-development)
- [Cloudflare setup](#cloudflare-setup)
- [CLI usage](#cli-usage)
- [WebMCP usage](#webmcp-usage)
- [Local MCP usage](#local-mcp-usage)
- [Security considerations](#security-considerations)
- [Testing](#testing)
- [Repository layout](#repository-layout)

---

## What is Liha Live Preview?

Upload an artifact, get a share URL, collect feedback, ship a fix to the same
URL. Concretely:

| Concept         | What it means                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| **Preview**     | A stable share URL, one origin per preview. Never changes.                               |
| **Version**     | An immutable snapshot of the artifact. Publishing a new one does not move the URL.       |
| **Comment**     | Anchored feedback, recorded against the version it was left on. Resolved, never deleted. |
| **Annotation**  | Pin, box, freehand, arrow or highlight, stored in normalized (0–1) coordinates.          |
| **Owner token** | A bearer token shown once at creation. No login system.                                  |

Supported artifacts: **static sites** (`index.html`, a `dist/` folder, or a zip),
**images** (PNG, JPEG, WebP, GIF, AVIF), **PDFs** (rendered with pdf.js, comments
per page), and **URLs** (snapshotted for markup).

### What makes the feedback usable by an agent

For a web preview, clicking an element records more than a coordinate:

```jsonc
{
  "body": "Make this button smaller.",
  "target": {
    "element": {
      "selector": "section.hero > button.cta",
      "tagName": "BUTTON",
      "textContent": "Get started",
      "htmlSnippet": "<button class=\"cta\">Get started</button>",
      "path": ["body", "main", "section.hero", "button.cta"],
    },
    "path": "/index.html",
    "viewport": { "width": 390, "height": 844 },
    "annotation": { "type": "pin", "point": { "x": 0.22, "y": 0.41 } },
  },
}
```

That is enough for an agent to find the right line of source without guessing.

### Writing a comment

The composer floats next to whatever you clicked, so feedback happens where you
are looking:

- **Click any element** in a web preview to attach a comment to its selector, or
  pick a tool and draw on an image, a PDF page or the page itself.
- **Threads.** Replies keep a discussion in one place; resolving a thread
  resolves its replies with it, and counts are per thread everywhere — sidebar,
  CLI, and agent tools alike.
- **Keyboard throughout.** `C` starts a comment, `⌘↵` sends it, `J`/`K` walk the
  list, `E` resolves, `V P R D A` pick tools, `?` lists the rest.
- **Drafts survive a reload**, and a comment link (`?comment=…`) reopens exactly
  that thread.

### Themes and languages

Light, dark, or follow the system — switched from the top bar or with `T`, and
applied before first paint so there is no flash. The palette is verified against
WCAG AA contrast in CI, in both themes.

The interface ships in **English and Japanese**, detected from the browser and
switchable from the top bar. Adding a language means one file: the catalogue is
typed against English, so a missing key will not compile.

---

## Architecture

```
┌────────────────────────────────┐    ┌──────────────────────────────────┐
│  Review screen (React + Vite)  │    │  Coding agent / terminal         │
│  lp-<slug>.example.net         │    │                                  │
│                                │    │   @liha/live-preview  (CLI)      │
│   ┌────────────────────────┐   │    │   @liha/mcp           (stdio MCP)│
│   │ WebMCP tools           │◄──┼── browser agent                       │
│   │ document.modelContext  │   │    └──────────────┬───────────────────┘
│   └────────────────────────┘   │                   │ HTTPS
│   ┌────────────────────────┐   │                   │
│   │ <iframe sandbox>       │   │                   │
│   │  lp-<slug>--<n>.  ─────┼───┼───────┐           │
│   │    example.net         │   │       │           │
│   └────────────────────────┘   │       │           │
└──────────────┬─────────────────┘       │           │
               │ JSON API                │ artifact  │
               ▼                         ▼           ▼
        ┌────────────────────────────────────────────────┐
        │  Hono on Cloudflare Workers                    │
        │    /api/*        JSON, owner + review auth     │
        │    review host   the app bundle                │
        │    artifact host sandboxed artifact bytes      │
        └──────────────┬──────────────────┬──────────────┘
                       │                  │
                  ┌────▼────┐        ┌────▼────┐
                  │   D1    │        │   R2    │
                  │metadata │        │ files   │
                  └─────────┘        └─────────┘
```

**Three origins, on purpose.** The landing page, each preview's review screen
(`lp-<slug>.example.net`) and each version's artifact
(`lp-<slug>--<version>.example.net`) are separate origins. Uploaded HTML is
untrusted code, so the browser's same-origin policy — not our own carefulness —
is what keeps it away from the owner token the review screen holds. Giving a
preview a whole origin also means any path under it belongs to that preview, so
its review screen can have sub-pages without colliding with the artifact's own
paths. See [docs/security.md](docs/security.md).

**Ports, not frameworks, at the boundary.** The API talks to `Database` and
`ObjectStore` interfaces that D1 and R2 satisfy structurally. Tests bind the same
routes to `node:sqlite` and an in-memory bucket, so integration tests run the
real SQL and the real migrations in milliseconds.

More detail: [docs/architecture.md](docs/architecture.md).

---

## Local development

Requirements: **Node ≥ 20.11** and **pnpm ≥ 9**. No Cloudflare account needed —
Wrangler runs Workers, D1 and R2 locally.

```bash
pnpm install
pnpm dev
```

That builds the workspace libraries, applies the D1 migrations to the local
database, and starts both apps:

|                 | URL                                       |
| --------------- | ----------------------------------------- |
| Web app         | <http://localhost:5173>                   |
| API             | <http://localhost:8787>                   |
| Preview content | `http://<slug>--<version>.localhost:8787` |

Open <http://localhost:5173>, drop in a folder or a PNG, and you have a share
URL.

Other commands:

```bash
pnpm test        # every package's tests
pnpm typecheck   # every package
pnpm build       # libraries, CLI, web bundle, API typecheck
pnpm db:migrate  # apply D1 migrations locally
```

> **Safari and `*.localhost`**
> Chrome, Edge and Firefox resolve any `*.localhost` name to 127.0.0.1, which is
> what gives each preview its own origin locally. Safari does not. If you develop
> in Safari, comment out `CONTENT_ORIGIN_TEMPLATE` in
> [`apps/api/wrangler.toml`](apps/api/wrangler.toml) — content is then served
> from a path on the API origin instead. It is still sandboxed, but no longer
> origin-isolated, so prefer a Chromium browser or Firefox.

---

## Cloudflare setup

```bash
pnpm run deploy
```

One command. It asks for your hostnames and a Cloudflare credential, then
creates the D1 database and R2 bucket, applies the migrations, deploys the
Worker, adds the DNS records, builds the web app with a Content-Security-Policy
naming your own hosts, deploys it to Pages, waits for the certificate, and
verifies the whole thing from the outside. Re-running it is safe.

```bash
pnpm run deploy --dry-run   # print the plan, touch nothing
```

You need a Cloudflare account and **two domains** on it: one for the app and
API, and a **separate** one that carries everything a stranger uploaded — both
each preview's review screen (`lp-<slug>.example.net`) and its artifacts
(`lp-<slug>--<n>.example.net`). Keeping those off your other domains means a
blocklisting caused by a malicious upload stops somewhere you use for nothing
else, and that uploaded HTML cannot set a cookie your app would receive. Both
sit one level under the apex, where Universal SSL covers them for free.
The script refuses the unsafe arrangement rather than letting you discover it
later.

Doing it by hand, the WebMCP origin trial, and what the deployment is checked
for: **[docs/deployment.md](docs/deployment.md)**.

```bash
pnpm verify:deployment --api https://api.example.com --app https://liha.example.com
```

Fifteen checks against a live instance, run for you at the end of a deploy and
useful on its own whenever you want to confirm one is healthy.

Configuration reference:

| Variable                  | Purpose                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`              | Where the web app lives. Used to build share URLs and to scope CORS.                                                                                            |
| `CONTENT_ORIGIN_TEMPLATE` | Hostname pattern for artifacts. `{slug}`, `{version}` and `{label}` (`<slug>--<version>`) are replaced. Unset falls back to a path mount (not origin-isolated). |
| `REVIEW_ORIGIN_TEMPLATE`  | Hostname pattern for review screens, `{slug}` replaced. Unset keeps share URLs at `APP_ORIGIN/p/<slug>`.                                                        |
| `API_ORIGIN`              | Where the API answers, when that is not the app's origin. A review screen has to name it in its own CSP.                                                        |
| `CONTENT_SIGNING_KEY`     | Secret. HMAC key for short-lived content grants on password-protected previews.                                                                                 |
| `ALLOWED_ORIGINS`         | Extra comma-separated origins allowed to call the API.                                                                                                          |
| `MAX_VERSION_BYTES`       | Upload cap per version. Default 30 MB.                                                                                                                          |
| `MAX_TOTAL_BYTES`         | Ceiling on everything the instance stores. Default 5 GB; `0` removes it.                                                                                        |

---

## CLI usage

```bash
npm install -g @liha/live-preview      # or: npx @liha/live-preview <command>
export LIHA_API_URL=https://api.liha.example.com
```

The one command that matters:

```bash
liha-preview deploy .
```

It reads `package.json`, detects the package manager from the lock file
(`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`), runs `build`
if there is one, finds the output (`dist`, `build`, `out`, `.output/public`, …),
uploads it, and prints the share URL. Run it again and it publishes a new version
to the **same URL** — the project is linked by a `.liha.json` written on first
deploy.

```
deploy [dir]           build + publish (create, then update)
upload <path>          create a preview from a file, folder or zip
update <path>          publish a new version of the linked preview
info                   preview, current version, comment counts
comments               list comments  (--status open|resolved|all)
comment <id>           one comment with annotation + DOM context
note <text>            add a comment from the terminal
resolve <id...>        mark comments resolved (owner only)
versions               list versions
use-version <n|id>     serve an older version at the same URL (owner only)
open                   print the share URL
link <id|slug>         point this project at an existing preview
mcp                    run the local MCP server on stdio
```

### Built for agents

Every command takes `--json`, and the contract is strict:

- **stdout** carries exactly one JSON document and nothing else.
- **stderr** carries progress and errors.
- **exit codes** are meaningful: `0` ok, `1` error, `2` usage, `3` not found,
  `4` auth, `5` conflict.

```bash
liha-preview comments --json \
  | jq -r '.comments[] | "\(.id)\t\(.target.selector)\t\(.body)"'
```

```jsonc
// liha-preview comments --json
{
  "ok": true,
  "status": "open",
  "counts": { "open": 1, "resolved": 0, "total": 1 },
  "comments": [
    {
      "id": "cm_LLwYhRz3Lsgrh99dqa8sQi",
      "status": "open",
      "authorName": "Sam",
      "body": "Make this button smaller — it dominates the hero.",
      "versionNumber": 1,
      "outdated": false,
      "target": {
        "selector": "section.hero > button.cta",
        "tagName": "BUTTON",
        "textContent": "Get started now",
        "htmlSnippet": "<button class=\"cta\">Get started now</button>",
        "path": "/index.html",
        "annotation": { "type": "pin", "point": { "x": 0.22, "y": 0.41 } },
      },
    },
  ],
}
```

Owner tokens are stored in `~/.config/liha/config.json` (mode `0600`), never in
the project. `.liha.json` holds only the preview id, slug and API URL, so it is
safe to commit.

---

## WebMCP usage

When the browser exposes the WebMCP imperative API, the preview page registers
its review tools on `document.modelContext`. An agent in the browser can then
read and act on the review **while the human watches the same screen** — a
comment an agent adds appears in the sidebar immediately, with no reload.

Feature detection is unconditional: without `document.modelContext` the app
behaves exactly as it does today.

| Tool                      | Hints                            | What it does                                                                                            |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `get_preview_info`        | read-only                        | Title, type, current version, comment counts.                                                           |
| `get_share_info`          | read-only                        | Share URL + a paste-ready summary, for handing to a Slack or email tool. Never returns the owner token. |
| `list_comments`           | read-only, **untrusted content** | Open/resolved/all, with targets.                                                                        |
| `get_comment`             | read-only, **untrusted content** | One comment with annotation geometry and DOM context.                                                   |
| `add_comment`             | write                            | Lets an agent leave review notes anchored to a selector or a point.                                     |
| `resolve_comment`         | write                            | Requires the owner token to be present in this browser.                                                 |
| `list_versions`           | read-only                        | Version history.                                                                                        |
| `get_review_summary`      | read-only, **untrusted content** | The whole review state in one call.                                                                     |
| `create_preview_from_url` | write, open-world                | Create a preview from a public URL.                                                                     |

**Comments are data, not instructions.** Everything a reviewer typed is returned
behind `untrustedContentHint`, wrapped in `<reviewer_comments>` delimiters, and
prefixed with an explicit note telling the agent to treat it as a description of
requested changes rather than as instructions addressed to it.

Using the package directly:

```ts
import { registerLihaTools, isWebMcpAvailable } from '@liha/webmcp';

const handle = registerLihaTools({
  getPreview: () => preview,
  getShareInfo: () => share,
  getVersions: () => versions,
  getComments: () => comments,
  isOwner: () => Boolean(ownerToken),
  addComment: (input) => api.addComment(slug, input),
  resolveComment: (id) => api.resolveComment(slug, id),
  onToolCall: (event) => toast(event.summary), // reflect agent activity in the UI
});

handle.available; // false when the browser has no WebMCP support
handle.unregister();
```

---

## Local MCP usage

For coding agents that run on your machine (Claude Code, Cursor, Zed, …):

```bash
liha-preview mcp --root .        # or: npx @liha/mcp --root .
```

```jsonc
// .mcp.json / claude_desktop_config.json
{
  "mcpServers": {
    "liha": {
      "command": "npx",
      "args": ["-y", "@liha/live-preview", "mcp", "--root", "/path/to/project"],
      "env": { "LIHA_API_URL": "https://api.liha.example.com" },
    },
  },
}
```

Tools: `get_preview_info`, `list_comments`, `get_comment`, `list_versions`,
`create_preview`, `update_preview`, `resolve_comment`.

The loop it is designed for:

1. `list_comments` — what did the reviewer ask for?
2. `get_comment` — which element, on which page, at which viewport?
3. edit the source and rebuild (the agent's own tools)
4. `update_preview` — same share URL, new version
5. `resolve_comment` — only after the fix is actually published

**The MCP server only ever touches files under `--root`.** Paths are resolved
through `realpath` and rejected if they land outside, so `..`, absolute paths and
symlinks that escape the project are all refused. Owner tokens are read from the
local credential store and never returned to the agent.

---

## Security considerations

Full write-up in [docs/security.md](docs/security.md). The short version:

- **Uploaded HTML is untrusted code.** It is served from a separate origin, in an
  iframe with `sandbox` and no `allow-same-origin`, plus a `Content-Security-Policy:
sandbox` header so it stays contained even when opened directly. It cannot read
  the app's storage or the owner token.
- **Path traversal.** Every upload and request path is normalized and rejected —
  not repaired — on `..`, absolute paths, backslashes, drive letters, control
  characters and percent-encoded variants. Archive entries are validated before
  decompression.
- **Owner tokens** are 256-bit random values stored only as SHA-256 digests. They
  travel in the URL _fragment_ of owner links, so they never reach a server log.
- **Passwords** are stored as salted PBKDF2-SHA256 (100k iterations, Web Crypto),
  never in plaintext. Wrong guesses are rate-limited per preview and client.
  Changing the password invalidates every existing reviewer session.
- **Password-protected content** is unlocked by a short-lived HMAC token scoped
  to one preview and one version, because an `<iframe src>` cannot carry an
  Authorization header. That token is rejected by the JSON API.
- **URL import** blocks loopback, private, link-local, CGNAT and cloud-metadata
  addresses, non-HTTP schemes, embedded credentials and unusual ports, and
  re-validates **every redirect hop**.
- **SVG uploads are not served as images.** They can carry script, so they are
  returned as `application/octet-stream` with `nosniff`.
- **Uploads are capped**: 30 MB and 2,000 files per version, 50 versions and
  300 MB per preview, 20 new previews per client per five minutes, and a 5 GB
  ceiling on everything the instance stores. Zip expansion is checked _before_
  decompression to refuse zip bombs.
- **Samples expire after 24 hours**, uploads never. An hourly cron sweeps them;
  the review screen counts the time down so nobody returns to a surprise 404.

Found something? See [SECURITY.md](SECURITY.md).

---

## Testing

```bash
pnpm test
```

240 tests, no network access required:

| Suite                | Covers                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@liha/shared`       | Token hashing, password KDF, path sanitizing, annotation serialization, SSRF blocklists.                                                          |
| `@liha/api`          | Full review loop against real SQL and real migrations; auth, password, traversal and isolation cases; the injected bridge script driven in jsdom. |
| `@liha/webmcp`       | Tool registration across five browser API shapes, Chrome's metadata budgets, schema-validated read and write paths.                               |
| `@liha/mcp`          | The agent loop over a real MCP client/server pair; workspace confinement including symlink escapes.                                               |
| `@liha/live-preview` | `upload`, `deploy`, `update`, `comments --json`; stdout/stderr separation and exit codes.                                                         |
| `@liha/web`          | Coordinate projection, the iframe message-origin check, sample expiry, and that every CSS custom property resolves.                               |

End-to-end tests run in real Chromium and cover the parts only a browser can
prove — the sandboxed iframe, the injected bridge, the annotation overlay, the
commenting flow, theming, and that uploaded script cannot reach the app's
storage. They include an **accessibility audit** (axe-core, WCAG 2.1 AA) of every
screen in both themes, which must report zero violations:

```bash
npx playwright install chromium
pnpm test:e2e
```

They start the dev servers themselves, and run on every pull request via
[GitHub Actions](.github/workflows/ci.yml).

Per-phase notes are in [docs/status.md](docs/status.md). An honest assessment of
what would and would not survive an enterprise procurement review is in
[docs/enterprise-readiness.md](docs/enterprise-readiness.md).

---

## Repository layout

```
apps/
  api/          Hono on Cloudflare Workers — JSON API + sandboxed content serving
  web/          React + Vite + TanStack Router/Query review UI
packages/
  shared/       Zod schemas, crypto, path and URL safety — runs everywhere
  webmcp/       document.modelContext tool registration
  mcp/          Local stdio MCP server + the shared credential store
  cli/          @liha/live-preview — the liha-preview binary
docs/           Architecture, security, WebMCP and readiness notes
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
