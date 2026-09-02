# @liha-cli/live-preview

Publish a build for review at a URL that never changes, and read the feedback
back without leaving the terminal.

```bash
npx @liha-cli/live-preview deploy ./dist
```

It prints a share URL. Send it to whoever is reviewing. Every later version
arrives at that same URL, so nobody needs a new link, and comments stay attached
to the version they were written on.

```bash
liha-preview comments --json     # what has been said, as structured data
liha-preview deploy .            # the fix, at the same URL
```

Reviewers click the thing they mean, and what comes back names it: the CSS
selector, the tag, the text, an HTML snippet, the page path, the viewport and
the version — captured at the moment of the gesture rather than guessed at
later.

## Where the feedback goes

`stdout` carries exactly one JSON document and nothing else, `stderr` carries
progress, and the exit codes mean something: `0` ok, `1` error, `2` usage,
`3` not found, `4` auth. So this composes.

```bash
liha-preview comments --json | jq -r '.comments[] | "\(.target.selector): \(.body)"'
```

## Against your own deployment

```bash
LIHA_API_URL=https://api.example.com liha-preview deploy ./dist
```

The whole thing is MIT and runs on Cloudflare Workers, D1 and R2 —
[the repository](https://github.com/liha-app/live-preview) deploys it to your
own account in one command.

## Also here

- [`@liha-cli/mcp`](https://www.npmjs.com/package/@liha-cli/mcp) — the same
  review, as tools a coding agent can call.
- [`@liha-cli/webmcp`](https://www.npmjs.com/package/@liha-cli/webmcp) — what
  publishes a review page's tools to an agent in the browser.
