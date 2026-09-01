# Build status

Recorded per phase, in the order the phases were built. "Remaining" lists work
that is deliberately not done, not work that was forgotten.

---

## Phase 1 — Vertical slice

**Implemented.** Upload (HTML file, static site directory, zip, image) → stable
share URL → sandboxed preview on an isolated content origin → comment → new
immutable version → same URL. D1 schema and migrations, R2 storage with a
per-version manifest, owner tokens (hashed), password protection (PBKDF2 + review
sessions + rate limiting), CORS, the full JSON API.

**Tests.** 48 unit tests in `@liha/shared`; 90 API tests covering the review loop
end to end plus owner auth, password flow, path traversal, content isolation,
zip handling, deletion, sample expiry and concurrent version writes.

**Remaining.** None for this phase.

**Known issues.** None.

---

## Phase 2 — Annotations

**Implemented.** Pin, rectangle, freehand, arrow and highlight, all stored in
normalized (0–1) coordinates. Overlay projection for fixed-size artifacts
(images, PDF pages) and for scrollable HTML documents, the latter re-projecting
on every scroll from bridge metrics. Element-context capture through the injected
bridge script: unique CSS selector, ancestor path, text, HTML snippet, bounding
rect and viewport.

**Tests.** Annotation serialization and bounds in `@liha/shared`; 12 jsdom tests
driving the real bridge script through its postMessage protocol; projection unit
tests in `@liha/web`.

**Remaining.** Highlight is in the schema and renders, but has no toolbar button.

**Known issues.** None.

---

## Phase 3 — CLI

**Implemented.** `deploy`, `upload`, `update`, `info`, `comments`, `comment`,
`note`, `resolve`, `versions`, `use-version`, `open`, `link`, `unlink`, `mcp`.
Package-manager detection from lock files, build execution, output-directory
detection, `--build-command` / `--output` overrides. `--json` on every command,
with stdout reserved for one JSON document and progress on stderr. Credential
store at `~/.config/liha/config.json` (0600) and a token-free `.liha.json`
project link.

**Tests.** 21 tests against a real HTTP server running the actual Worker app,
covering upload, deploy (build success and failure), the full comment → update →
resolve loop, status filtering, version restore, credential resolution, stream
separation and exit codes.

**Remaining.** No upload progress reporting for large directories.

**Known issues.** None.

---

## Phase 4 — WebMCP

**Implemented.** `@liha/webmcp` registers nine tools on
`document.modelContext`: `get_preview_info`, `get_share_info`, `list_comments`,
`get_comment`, `add_comment`, `resolve_comment`, `list_versions`,
`get_review_summary`, and `create_preview_from_url`. Full input schemas,
`readOnlyHint` on reads, `untrustedContentHint` plus delimiters on everything
carrying reviewer-written text. Feature-detected; the app is unaffected without
browser support. Agent tool calls run through the same mutations the UI uses, so
results appear in the sidebar with no reload, and a toast shows agent activity.

**Tests.** 19 tests against a mocked `document.modelContext`: registration,
annotations, unregistration, every read and write path, untrusted-content
framing, the owner-token refusal, host failures and the no-support case.

**Remaining.** None for this phase.

**Known issues.** The WebMCP imperative API is still a moving target;
`registerLihaTools` handles both the `registerTool` return-handle and
`unregisterTool(name)` teardown shapes.

---

## Phase 5 — Local MCP

**Implemented.** `@liha/mcp` serves seven tools over stdio using the official
SDK: `get_preview_info`, `list_comments`, `get_comment`, `list_versions`,
`create_preview`, `update_preview`, `resolve_comment`. Started with
`liha-preview mcp --root <dir>` or the `liha-mcp` binary. Every path is resolved
through `realpath` and refused if it lands outside the project root. Owner tokens
come from the shared credential store and are never returned to the agent.

**Tests.** 11 tests over a real MCP client/server pair: the full
create → comment → read context → update → resolve loop, workspace confinement
including symlink escape, dependency-directory skipping, and owner-permission
refusals.

**Remaining.** None for this phase.

**Known issues.** None.

---

## Phase 6 — PDF

**Implemented.** PDF previews render with pdf.js, one annotation layer per page,
page number stored on the comment target. Bytes are fetched from the content
origin, which sends `Access-Control-Allow-Origin` for the app origin only.

**Tests.** Covered by the API's artifact-detection tests (magic-number sniffing)
and the shared annotation tests for page targets.

**Remaining.** No page navigation control; the viewer is a continuous scroll.
Text selection and text-layer highlighting are not implemented.

**Known issues.** Large PDFs render every page eagerly. Fine for review
documents, slow for a 200-page report.

---

## Phase 7 — URL import

**Implemented.** `POST /api/previews/url` and the home-page importer.
`assertPublicHttpUrl` blocks non-HTTP schemes, embedded credentials, unusual
ports, internal hostnames and every private/loopback/link-local/CGNAT/metadata
address range for IPv4 and IPv6 (including mapped and 6to4 forms). `safeFetch`
re-validates every redirect hop. The page is snapshotted with an injected
`<base>` so it lands on the isolated content origin and gets the review bridge
like any other HTML preview.

**Tests.** 8 SSRF tests covering ~40 blocked URL shapes, redirect
re-validation, relative-redirect escapes and redirect limits.

**Remaining.** Screenshot capture is defined as a `ScreenshotProvider` interface
with a Cloudflare Browser Rendering implementation, but no provider is wired in
by default — it needs a paid binding. Only the entry document is snapshotted;
sub-resources still load from the origin site.

**Known issues.** DNS rebinding is out of reach from a Worker; documented in
[security.md](security.md) and SECURITY.md rather than silently ignored.

---

## Phase 8 — Polish

**Implemented.** Minimal UI with Lucide icons and a single floating bottom
toolbar. Viewport widths (fit / 1280 / 768 / 390) for web previews. Version
switcher, share dialog, owner settings, password gate, agent-activity toasts.
README, CONTRIBUTING, SECURITY, architecture, security and WebMCP docs. MIT
licence.

**Tests.** 7 Playwright E2E tests in real Chromium: cross-origin sandboxed iframe
rendering, root-absolute asset resolution, DOM-context capture on click,
red-pen drawing (including that the stroke resolves to a real colour), version
publish keeping the share URL, resolve, the password gate, and a test asserting
uploaded script cannot read the app's storage or its parent frame.

**Remaining.** No CI workflow. No dark/light toggle — the UI follows the system
setting. Mobile layout is functional but not optimised.

**Known issues.** Preview content is served from `*.localhost` subdomains in
local development, which Safari does not resolve; the README documents the
one-line fallback.

---

## Phase 10 — Localization and the challenge submission

**Implemented.** English and Japanese throughout the interface, detected from
the browser and switchable from the top bar, with the catalogue typed against
English so a missing key is a compile error. Locale-aware relative timestamps
and date formatting via `Intl`. A Japanese README. Submission material for the
OpenAI WebMCP Challenge: strategy, deployment runbook, demo script and Devpost
copy under `docs/challenge/`.

**Tests.** Five localization end-to-end tests: browser-language detection,
switching and persistence, the whole review screen in Japanese, dialogs and
shortcuts, and an axe-core WCAG 2.1 AA pass in Japanese.

**Fixed along the way.** The composer now opens on `pointerdown` rather than
`click`, so it is mounted and focused a full mouse-press earlier.

**Known issues.** Typing that begins in the same frame as the click can still
lose a character: the composer cannot exist until the click has crossed the
iframe postMessage boundary. The pointerdown change shrinks that window to well
under human reaction time, and the end-to-end test asserts the guarantee that
actually holds — once the composer is on screen, it holds the caret.

---

## Totals

|                          |                                                             |
| ------------------------ | ----------------------------------------------------------- |
| Unit + integration tests | 240, `pnpm test`, no network needed                         |
| End-to-end tests         | 63, `pnpm test:e2e`, real Chromium, incl. WCAG 2.1 AA audit |
| Packages                 | 6                                                           |
| Migrations               | 4                                                           |
| Languages                | English, Japanese                                           |
