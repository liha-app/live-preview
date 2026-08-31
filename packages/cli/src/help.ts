export const HELP = `liha-preview — share build artifacts for review, and close the loop.

USAGE
  liha-preview <command> [options]

COMMANDS
  deploy [dir]            Build the project, publish the output, print the share URL.
                          Creates the preview the first time, adds a version after that.
  upload <path>           Create a preview from a file, directory or zip.
  update <path>           Publish a new version of the linked preview (same share URL).
  info                    Show the preview, its current version and comment counts.
  comments                List review comments. Add --json for agent-readable output.
  comment <id>            Show one comment with its annotation and DOM context.
  note <text>             Add a comment from the terminal.
  reply <id> <text>       Reply in a review thread, so the reviewer sees the answer.
  resolve <id...>         Mark comments resolved (owner only).
  versions                List every version.
  use-version <n|id>      Serve an older version at the same share URL (owner only).
  open                    Print the share URL (and open it with --open).
  link <id|slug>          Point this project at an existing preview.
  unlink                  Forget the stored credentials for this preview.
  mcp                     Run the local MCP server on stdio, for coding agents.

COMMON OPTIONS
  --json                  Emit a single JSON document on stdout. Nothing else.
  --quiet                 Suppress progress output on stderr.
  --api <url>             API base URL (default: $LIHA_API_URL or http://localhost:8787).
  --preview <id|slug>     Target a specific preview instead of the linked one.
  --token <ownerToken>    Owner token (default: $LIHA_OWNER_TOKEN or the credential store).

UPLOAD OPTIONS
  --title <text>          Preview title.
  --password <text>       Require a password to view (min 6 characters).
  --label <text>          Label this version.
  --no-link               Do not write .liha.json.

DEPLOY OPTIONS
  --build-command <cmd>   Override the detected build command.
  --output <dir>          Override the detected output directory.
  --skip-build            Publish what is already on disk.

COMMENT OPTIONS
  --status <open|resolved|all>   Which comments to list (default: open).
  --all                          Same as --status all.

EXIT CODES
  0 success   1 error   2 usage   3 not found   4 auth   5 conflict

EXAMPLES
  liha-preview deploy .
  liha-preview comments --json | jq '.comments[] | {id, body, selector: .target.selector}'
  liha-preview update ./dist && liha-preview resolve cm_abc123
`;
