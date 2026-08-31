# Can you sell this to a company today?

Short answer: **not as a paid enterprise product. Yes as a free OSS tool, a
design-partner pilot, or a self-hosted team tool.**

The engineering is solid. What is missing is not quality — it is the set of
things a procurement and security review asks for before signing, most of which
were explicitly out of scope for the MVP.

This document is the honest version. It exists so nobody walks into a customer
meeting and gets surprised.

---

## What would pass a review today

| Area                            | State                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Untrusted content isolation** | Separate origin per preview version, iframe `sandbox` without `allow-same-origin`, `CSP: sandbox` header. Proven by a test that loads hostile script and asserts it cannot read storage or its parent. |
| **Path traversal**              | One rejecting implementation, used by uploads, archives and request handling. 13 unit tests plus API cases covering encoded and double-encoded forms.                                                  |
| **Credential handling**         | Owner tokens are 256-bit random, stored only as SHA-256, delivered in the URL fragment. Passwords are salted PBKDF2-SHA256 with per-preview rate limiting.                                             |
| **SSRF**                        | Scheme, port, hostname and address blocklists for IPv4 and IPv6, re-validated on every redirect hop. ~40 blocked URL shapes under test.                                                                |
| **Abuse limits**                | 50 MB / 2,000 files per version, size checked before zip expansion, comment rate limiting per client.                                                                                                  |
| **Accessibility**               | Zero axe-core WCAG 2.1 AA violations on every screen in both themes, verified in CI. Full keyboard operation, focus trapping in dialogs, reduced-motion support, live-region announcements.            |
| **Test coverage**               | 173 unit and integration tests plus 43 end-to-end tests in real Chromium. Integration tests run the shipped SQL and migrations.                                                                        |
| **CI**                          | Format, typecheck, test, build and E2E on every pull request.                                                                                                                                          |
| **Licence**                     | MIT, no third-party licence conflicts.                                                                                                                                                                 |

---

## What would stop a deal

Ordered by how early it kills the conversation.

### 1. No identity system — blocking

There are no accounts, no SSO, no SAML/OIDC, no SCIM provisioning. Whoever holds
a preview's owner token is its owner, and tokens cannot be rotated or revoked
individually.

For a company this means: no "remove access when someone leaves", no per-user
audit trail, no group permissions. Enterprise IT will not approve a tool that
cannot be tied to their directory.

**Effort:** large. OIDC login, an organisations/members model, per-resource
roles, and a migration path for existing token-owned previews.

### 2. No audit log — blocking for regulated buyers

Nothing records who viewed a preview, when, or from where. Finance, healthcare
and public-sector buyers treat this as mandatory.

**Effort:** medium. Append-only event table, retention policy, export.

### 3. Data governance is undefined — blocking

No retention policy, no documented deletion SLA, no data-residency choice, no
DPA, no sub-processor list, no backup or restore procedure. Deleting a preview
removes its rows and objects immediately, which is good, but nothing is written
down and nothing is contractual.

GDPR-exposed buyers will also ask where reviewer names and comment text live and
for how long. Today: in D1, forever.

**Effort:** small technically, real work legally.

### 4. Single-tenant assumptions

Slugs are unguessable but global; there is no per-tenant isolation, quota or
billing boundary. Fine for OSS and self-hosting, wrong for multi-tenant SaaS.

### 5. Operational maturity

No error reporting integration (there is one clearly-marked hook in
`ErrorBoundary`), no metrics, no alerting, no runbook, no documented SLO, no
load testing. Nobody has run this under concurrent load.

### 6. Smaller gaps that still get asked about

- **English only.** No i18n scaffolding — relevant given the likely first market.
- **Browser support** is undocumented and untested outside Chromium. Safari
  cannot resolve the `*.localhost` dev origin, and Safari/Firefox are not in CI.
- **Mobile** works but is not designed for; annotating on a phone is awkward.
- **No SLA or support channel.**
- **PDF rendering** loads every page eagerly; a 200-page document will crawl.

---

## Where it is genuinely differentiated

Worth being clear about this, because it is the reason to keep going:

The product's actual claim is not "share a file". It is that a human pointing at
a button becomes **structured, machine-actionable context** — CSS selector, DOM
snippet, page, viewport, version — that an agent can act on through three
surfaces (WebMCP in the browser, MCP locally, a JSON CLI) and ship a fix to the
same URL without anyone copying and pasting anything.

That loop works today, end to end, and the tests prove it. Nothing in the
blocking list above is a flaw in that idea; it is all the scaffolding a company
needs around any tool before they can buy it.

---

## Recommended sequencing

**Now — ship as OSS.** Self-hosting on a company's own Cloudflare account
sidesteps most of the list: their data stays in their account, their network
controls apply, and there is no DPA to negotiate. Position it as a developer
tool, not a SaaS.

**Design-partner pilots.** One or two teams, self-hosted or on a shared
instance, with the gaps stated in writing up front. This is where you find out
whether threads, versions and agent hand-off match how teams actually review.

**Before charging enterprises**, in order:

1. OIDC/SSO plus an organisation and membership model
2. Audit log with export
3. Written retention, deletion and sub-processor documentation
4. Error reporting, metrics and an on-call runbook
5. Load testing with published numbers
6. Cross-browser CI (Safari, Firefox) and a supported-browser statement

Items 1–3 are the difference between "interesting project" and "purchasable
product". Items 4–6 are the difference between selling it once and keeping it.
