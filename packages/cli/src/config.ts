/**
 * The CLI and the local MCP server share one credential store
 * (`~/.config/liha/config.json`) and one project link file (`.liha.json`), so
 * an agent started from either entry point sees the same previews. The
 * implementation lives with the MCP server; this module is its CLI-facing name.
 */
export {
  DEFAULT_API_URL,
  PROJECT_FILE,
  configDir,
  configPath,
  findCredential,
  findProjectLinkPath,
  forgetPreview,
  readGlobalConfig,
  readProjectLink,
  rememberPreview,
  writeGlobalConfig,
  writeProjectLink,
  type GlobalConfig,
  type PreviewCredential,
  type ProjectLink,
} from '@liha/mcp/credentials';
