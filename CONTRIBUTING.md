# Contributing to Liha Live Preview

Thanks for taking a look. This project is early, and the parts that matter most
are the ones that make review feedback legible to an agent.

## Getting set up

```bash
pnpm install
pnpm dev      # web on :5173, API on :8787
pnpm test
```

Node ≥ 20.11 and pnpm ≥ 9. Nothing else — no Cloudflare account is needed to
develop or to run the tests.

## Before you open a pull request

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

All four must pass. There is no CI gate that will catch it for you yet.

## How the code is organized

| Package           | Rule of thumb                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Must run on Workers, Node **and** in the browser. No `node:` imports, no DOM assumptions beyond fetch/URL/crypto.   |
| `apps/api`        | Route code talks to the `Database`/`ObjectStore` ports, never to D1/R2 directly. That is what keeps the tests fast. |
| `apps/web`        | Presentational components take callbacks; data fetching lives in the route.                                         |
| `packages/webmcp` | Framework-agnostic. It receives a host object; it must not import React.                                            |
| `packages/mcp`    | Never reads a file outside the configured project root.                                                             |
| `packages/cli`    | stdout is a machine contract. Progress goes to stderr, always.                                                      |

## Things worth knowing

**Security-relevant code has tests that read like a threat list.** If you touch
path handling, token hashing, password verification, the sandbox headers or the
SSRF blocklist, add the case you are worried about to the existing test file
rather than a new one — they are meant to be readable as a checklist.

**Comments from reviewers are untrusted input.** Anything that surfaces them to
an agent must keep the `untrustedContentHint` annotation and the delimiters. If
you add a tool that returns user-written text, do the same.

**Annotations are stored normalized (0–1).** Never persist pixels; a comment has
to survive a different viewport, zoom level and device pixel ratio.

**Versions are immutable.** Publishing never overwrites. If you find yourself
wanting to mutate a version, the answer is a new one.

## Style

Prettier settings live in `.prettierrc.json`; run `pnpm format`. Beyond that:
match the surrounding code. Comments should explain _why_ — the what is already
in the code.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
