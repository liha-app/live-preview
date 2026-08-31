# Security policy

## Reporting a vulnerability

Please report security issues privately, via a
[GitHub security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, rather than in a public issue.

Please include what you did, what happened, and what you expected. A proof of
concept against a local `pnpm dev` instance is ideal.

## Scope

Liha Live Preview hosts and serves **untrusted user-uploaded content**, so the
following are always in scope:

- Escaping the preview sandbox: reaching the app origin, its storage, or an
  owner token from uploaded HTML or JavaScript.
- Reading or writing a preview without the owner token, or without the password
  on a protected preview.
- Path traversal out of a preview's storage prefix.
- SSRF through URL import.
- Any way to make the API serve uploaded bytes with a content type that executes
  on the app origin.

## Known limitations

These are documented rather than fixed, and are described in full in
[docs/security.md](docs/security.md):

- **DNS rebinding on URL import.** The URL validator inspects hostnames and
  literal addresses, but a Worker cannot see the resolved IP. Deployments that
  care should place egress controls in front of the fetch.
- **Path-mounted content fallback.** When `CONTENT_ORIGIN_TEMPLATE` is unset,
  preview content is served from a path on the API origin. It is still
  sandboxed, but it is not origin-isolated. Production deployments should always
  configure a wildcard content origin.
- **No account system by design.** Anyone holding a preview's owner token is its
  owner. Tokens cannot currently be rotated.
