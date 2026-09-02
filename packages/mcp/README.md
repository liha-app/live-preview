# @liha-cli/mcp

An MCP server for [Liha Live Preview](https://github.com/liha-app/live-preview):
lets a coding agent read what reviewers said and ship the fix to the same URL.

```json
{
  "mcpServers": {
    "liha": {
      "command": "npx",
      "args": ["-y", "@liha-cli/mcp"],
      "env": { "LIHA_API_URL": "https://api.example.com" }
    }
  }
}
```

The agent gets the feedback as structured data — the selector, the tag, the
text, the HTML around it, the page path, the viewport and the version — rather
than a sentence and a screenshot. It can reply in the thread under its own name,
publish a new version, and resolve what it fixed.

It reads and writes files only under a project root you name. Nothing else on
the machine is reachable through it.

## Also here

- [`@liha-cli/live-preview`](https://www.npmjs.com/package/@liha-cli/live-preview)
  — the same review from the terminal.
