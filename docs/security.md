# Security

Liha Live Preview hosts arbitrary uploaded HTML and serves it to browsers. That
single fact drives most of the design below.

## Threat model

| Adversary                            | Wants                                                     | Held off by                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Someone who uploads a malicious site | To reach the app origin, owner tokens, or other previews  | Separate content origin, iframe `sandbox` without `allow-same-origin`, `CSP: sandbox` header, no cookies on the content origin |
| Someone with a share link            | To publish versions, resolve comments, delete the preview | Owner token required on every mutating route                                                                                   |
| Someone guessing                     | To find unlisted previews, or a preview password          | 60-bit random slugs, PBKDF2 password hashing, per-preview rate limiting                                                        |
| A malicious archive                  | To write outside its storage prefix                       | Path sanitizing before decompression, expansion-ratio and count checks                                                         |
| A crafted URL import                 | To reach internal services                                | Address and hostname blocklists, scheme and port allowlists, per-hop redirect re-validation                                    |
| A comment author                     | To hijack an agent reading the review                     | `untrustedContentHint`, delimiters, explicit framing as data                                                                   |

## Isolating uploaded content

Preview files are served from `https://lp-<slug>--<version>.example.com`, never
from an origin the app is served on. Three independent layers apply:

1. **Different origin.** The same-origin policy prevents uploaded script from
   reading the app's `localStorage`, where owner tokens live. The review screen
   for a preview is a sibling hostname — `lp-<slug>.example.com` — so it is a
   different origin from the artifact it displays, not merely a different path.
2. **Iframe sandbox.** The app embeds content with
   `sandbox="allow-scripts allow-forms allow-popups allow-modals"` — note the
   absence of `allow-same-origin`, which gives the document an opaque origin with
   no storage access at all.
3. **Response headers.** Every content response carries:

   ```
   Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
                            allow-popups-to-escape-sandbox allow-modals
   X-Content-Type-Options: nosniff
   Referrer-Policy: no-referrer
   Cross-Origin-Resource-Policy: cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
   ```

   The CSP header means the document is sandboxed even when opened directly in a
   tab, not only when framed.

No cookies are ever set on the content origin. All API authentication uses
headers, so there is nothing for the browser to attach to a content request.

### Content types

Content types come from the version manifest, recorded at upload time by
**sniffing magic numbers**, not by trusting the client-supplied MIME type or the
file extension. A file named `photo.png` containing HTML is refused as an image
preview.

**SVG is deliberately not a supported image type.** SVG can carry script, and
serving it as `image/svg+xml` would execute it on the content origin. SVG files
inside a static site upload are stored and served as
`application/octet-stream` with `nosniff`.

### The path-mounted fallback

If `CONTENT_ORIGIN_TEMPLATE` is unset, content is served from
`/content/:slug/:version/*` on the API origin. The sandbox headers and iframe
attributes still apply, but the app and the content share an origin, so layer 1
is gone. **Always configure a wildcard content origin in production.** The
worker logs a warning at startup when it is missing.

### Who may read an artifact

The app reads artifact bytes with `fetch()`: pdf.js renders a PDF from them, and
`read_artifact_file` hands source to an agent. So the artifact has to name a
reader in `Access-Control-Allow-Origin`, and it names exactly one — the screen
that artifact belongs to. Another preview's review screen is refused. An
artifact is nobody else's business, including another preview's.

### A domain shared with other services

The deployment holds a wildcard route because Cloudflare cannot route on
anything narrower, so the Worker decides by hostname and leaves anything it does
not recognise alone rather than claiming it. `matchReviewHost` and
`matchContentHost` match exactly around their placeholders: a slug cannot
contain a hyphen, so `lp-<slug>` and `lp-<slug>--<n>` are unambiguous, and
`cms-abc.example.com` belongs to whoever else wants it. The same matching gates
CORS, so a lookalike origin is not handed access either.

## Path traversal

`packages/shared/src/paths.ts` is the single implementation, used by uploads,
archive extraction and request handling alike. It **rejects** rather than
repairs:

- `..` segments, at any depth
- absolute paths and leading `/`
- backslashes, Windows drive letters, UNC prefixes
- NUL and other control characters
- paths or segments over the length limits
- `.git`, `.env`, `.DS_Store`, `__MACOSX` segments

Request paths go through `decodeAndSanitizePath`, which decodes percent-encoding
**exactly once** and then refuses anything that still contains encoded
separators — so `..%2f..%2f` and `%252e%252e%252f` are both blocked.

Archive entries are validated inside fflate's `filter` callback, which runs
_before_ decompression, so a hostile zip is rejected without being expanded.

## Owner tokens

- 32 bytes from `crypto.getRandomValues`, prefixed `liha_ot_`.
- Stored only as a SHA-256 digest. A single hash pass is correct here: the token
  is not guessable, so a slow KDF would buy nothing.
- Compared in constant time.
- Delivered in the **URL fragment** of owner links (`#owner=…`), which browsers
  never send to a server, and stripped from the address bar on load.
- Accepted as `X-Liha-Owner-Token` or `Authorization: Bearer`.

The CLI and MCP server store them in `~/.config/liha/config.json`, created with
mode `0600` in a directory created with mode `0700`. The project-local
`.liha.json` contains only the preview id, slug and API URL — never the token —
so it is safe to commit.

## Passwords

- PBKDF2-SHA256, 100,000 iterations, 16-byte random salt, via Web Crypto. This is
  the strongest KDF available on Workers; there is no scrypt or Argon2.
- Encoded as `pbkdf2-sha256$<iterations>$<salt>$<hash>` so the cost can be raised
  later without invalidating existing previews.
- Verified in constant time. Malformed records return `false` rather than
  throwing.
- Failures are counted per preview and per hashed client address in a sliding
  window (10 attempts / 10 minutes) and answered with `429` beyond that.
- Changing or removing a password deletes every existing review session.

### Serving protected content to an iframe

An `<iframe src>` cannot carry an `Authorization` header. After a correct
password, the API issues a **signed content grant**: an HMAC-SHA256 token naming
one preview, one version and an expiry, appended to the content URL as `?t=`.

It is deliberately narrow:

- valid only for the exact preview and version it names,
- valid for one hour,
- accepted **only** by the content route — the JSON API ignores it entirely,
- and protected responses are served `Cache-Control: private, no-store`.

## URL import (SSRF)

`assertPublicHttpUrl` rejects, before any request is made:

- schemes other than `http`/`https` (`file:`, `gopher:`, `data:`, `javascript:`)
- URLs with embedded credentials
- ports outside `80, 443, 8080, 8443`
- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`,
  `metadata.google.internal`, `instance-data`
- hostnames with no dot (bare internal names)
- IPv4 in `0/8`, `10/8`, `127/8`, `100.64/10`, `169.254/16` (cloud metadata),
  `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`,
  `198.51.100/24`, `203.0.113/24`, and everything from `224/4` up
- IPv6 loopback, unspecified, unique-local (`fc00::/7`), link-local
  (`fe80::/10`), multicast, NAT64, Teredo, and IPv4-mapped or 6to4 addresses
  whose embedded IPv4 is private

Alternative IPv4 encodings (`http://2130706433/`, `http://0x7f000001/`) are
normalized by the WHATWG URL parser before the checks run, and are covered by
tests.

`safeFetch` follows redirects manually and re-validates **every hop**, because a
public URL says nothing about where its `302` points.

### Known limitation: DNS rebinding

A Worker cannot see the IP a hostname resolves to, so a hostname that passes
validation and then resolves to `169.254.169.254` is not caught here. Mitigate
at the network layer for deployments that care. This is stated in
[SECURITY.md](../SECURITY.md) rather than quietly ignored.

## Notifications

- **The owner token never leaves its origin.** Setting up notifications happens
  on a different origin, so the review screen trades the token for a grant that
  authorises one thing — watching one preview — and expires in ten minutes. The
  grant carries its own signature prefix, so a content grant can never be spent
  as one and the other way round. It travels in the URL fragment, which browsers
  do not send to servers and proxies do not log, and the page it lands on spends
  it and removes it.
- **Push messages carry nothing.** Payload encryption (RFC 8291) needs the
  subscription's `p256dh` and `auth` keys; an empty push does not, so those keys
  are never requested and never stored. Only the endpoint is held. A copy of the
  database cannot be used to send anybody anything, and what a notification says
  is fetched when it is shown rather than queued when it was sent.
- **A push endpoint is a URL a client supplies and this server later fetches**,
  which is the shape of every SSRF. It goes through the same check as URL
  import, plus https only.
- **Anyone who can read a preview can ask to be notified about it** — the same
  check that gates reading gates this, so a password-protected preview stays
  gated. The owner is never told about their own comment.
- **One comment wakes every watcher**, so the watcher count is the fan-out of
  one request into requests at other people's servers. Fifty per preview, and
  ten new setups per client per five minutes.
- **The VAPID keypair is generated per deployment** and the private half is a
  Worker secret. A development pair is committed so `pnpm dev` works out of the
  box; the Worker warns loudly if it is ever seen in a deployment, and a test
  fails if that guard stops matching the committed key.
- The notification origin serves one page, its script and a service worker,
  under `default-src 'none'; script-src 'self'` — an origin holding a
  notification permission is not one to guard with `unsafe-inline`.

## Imported pages

- **A snapshot's own Content-Security-Policy is removed.** Such a policy is
  written in terms of `'self'`, and `'self'` is wherever the document is served
  from — so moving the document silently redefines every rule in it. The site's
  own stylesheets and scripts become third-party to it and it blocks them; the
  review bridge is inline, so it blocks that too, and feedback on an imported
  page loses the DOM context that is the point of it.

  Nothing is given up. What keeps a snapshot harmless is the
  `Content-Security-Policy: sandbox` header this server sends and the iframe it
  is shown in, neither of which the snapshot can reach. Every other tag is left
  exactly as it was.

### What a snapshot cannot carry

A snapshot is the same markup served from somewhere else. Measured against a
real site:

| Loaded by the snapshot    | Result    |
| ------------------------- | --------- |
| `<link rel="stylesheet">` | loads     |
| `<img>`                   | loads     |
| classic `<script src>`    | loads     |
| `<script type="module">`  | **fails** |
| web fonts                 | **fails** |

The two that fail are the two a browser fetches in CORS mode, and they fail for
the same reason: the origin site has to say other origins may use them, and
almost none do — until something like this existed, nothing needed it. So a
modern site snapshots with its layout intact, in a fallback face, with anything
driven by a module script inert.

This end cannot fix it without becoming a page archiver: fetching every
stylesheet, rewriting every `url()`, storing the assets. The review screen says
so instead, on the preview itself — a reviewer who does not know is a reviewer
filing feedback about type that is only wrong here.

A site owner reviewing their own pages can send `Access-Control-Allow-Origin: *`
on those responses, which is what public font CDNs have always done. Nobody
reviewing somebody else's site can, which is why the archiver is the real fix
rather than the note.

## Denial of service

- 30 MB and 2,000 files per version (configurable via `MAX_VERSION_BYTES`).
  The ceiling is the runtime's: a Worker isolate has 128 MB of memory, and the
  upload path holds the multipart body and the expanded entries at once.
- 25 MB per individual file.
- File count, not size, is what makes a large upload slow. Every file is one
  R2 write, they are issued 16 at a time, and a Worker holds about six
  connections open at once — so the throughput is roughly six files a second
  regardless of how small they are. A 169-file site takes about 30 seconds; the
  2,000-file ceiling would take about five minutes. Measured against the real
  bucket, not estimated.
- 50 versions and 300 MB per preview, so one share URL cannot grow without
  bound even though its owner holds a valid token.
- 20 new previews per client per five minutes, checked before the body is read.
  Creating a preview — by upload or by URL import — needs no credential.
- A ceiling on everything the instance stores, 5 GB by default and configurable
  with `MAX_TOTAL_BYTES`. Rate limiting only slows an abuser down; twenty
  uploads every five minutes is still hundreds of gigabytes a day, and an
  attacker with addresses to spare is not rate limited at all. The ceiling is
  what actually stops, and it is checked before anything reaches R2. Deleting a
  preview frees its space. For a public instance, put a Cloudflare WAF rate
  limiting rule in front as well: it sheds load at the edge, before a request
  costs you a Worker invocation.
- Nothing is kept forever, and the clock counts from last use rather than from
  upload — a review still being read must not vanish in the middle of it. A
  sample gets a flat 24 hours and does not slide, because it is minted per
  curious visitor for something nobody comes back to; an anonymous upload gets a
  week, a signed-in one a month, and the owner can push either out by hand. An
  hourly cron sweeps what is due, R2 objects first and then the row, in bounded
  batches.
- `Content-Length` is checked before the multipart body is parsed.
- Zip expansion size and entry count are checked before decompression.
- Comment bodies are capped at 10,000 characters; every string in a comment
  target has a length bound in its Zod schema, so a hostile page cannot inflate
  a comment through the bridge.

## Agent-facing safety

Review comments are written by whoever has the share link, and they end up in an
agent's context. Every tool that returns them:

- sets `untrustedContentHint` (WebMCP) so the client can mark it,
- wraps the payload in `<reviewer_comments>` / `<reviewer_comment>` delimiters,
- prefixes it with an explicit note that the content describes requested changes
  and is not addressed to the agent.

The local MCP server adds a filesystem boundary: it resolves every path through
`realpath` and refuses anything outside `--root`, so `..`, absolute paths and
symlinks pointing out of the project are all rejected. Owner tokens are read
from the credential store and never returned in a tool result.

`get_share_info` is the tool designed for "send this to the team", and it
returns the share URL and a summary — never the owner token.
