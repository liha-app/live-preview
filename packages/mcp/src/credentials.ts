import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Where this talks to when nothing says otherwise.
 *
 * The hosted instance, so `npx @liha-cli/live-preview deploy .` works with
 * nothing configured — which is the whole promise of that line. Anything more
 * specific wins: `--api`, `LIHA_API_URL`, the project's own `.liha.json`, or
 * `~/.config/liha/config.json`. Running against your own deployment is one
 * environment variable.
 *
 * Because this default sends somebody's build somewhere, every command that
 * publishes prints where it is publishing to before it does.
 */
export const DEFAULT_API_URL = 'https://api-livepreview.liha.dev';
export const PROJECT_FILE = '.liha.json';

export class CredentialTargetError extends Error {
  readonly code = 'credential_api_mismatch';

  constructor(
    message = 'The selected API does not match this credential. Use credentials for that API, or explicitly link it with its own token.',
  ) {
    super(message);
    this.name = 'CredentialTargetError';
  }
}

/** API credentials are scoped to the complete base URL, including its path. */
export function normalizeApiUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href.replace(/\/$/, '');
  } catch {
    throw new CredentialTargetError(
      'The API must be an HTTP(S) base URL without credentials, query or fragment.',
    );
  }
}

/** Plain HTTP is only supported for loopback development when carrying a credential. */
export function credentialRequestApiUrl(raw: string, authenticated: boolean): string {
  const normalized = normalizeApiUrl(raw);
  const url = new URL(normalized);
  if (
    authenticated &&
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new CredentialTargetError('Credentials require HTTPS, except for loopback development.');
  }
  return normalized;
}

export function assertCredentialApi(apiUrl: string, credentialApiUrl: string | undefined): void {
  if (
    !credentialApiUrl ||
    credentialRequestApiUrl(apiUrl, true) !== normalizeApiUrl(credentialApiUrl)
  ) {
    throw new CredentialTargetError();
  }
}

/** Preview and comment ids are single route segments, never URL syntax. */
export function apiPathSegment(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CredentialTargetError(
      'Preview and comment identifiers must be single URL path segments.',
    );
  }
  return encodeURIComponent(value);
}

/** Check the final URL as well as the selected API before attaching a credential. */
export function apiRequestUrl(apiUrl: string, path: string): string {
  const base = new URL(normalizeApiUrl(apiUrl));
  const request = new URL(`${normalizeApiUrl(apiUrl)}${path}`);
  const prefix = `${base.pathname.replace(/\/+$/, '')}/api/`;
  if (
    !path.startsWith('/api/') ||
    request.origin !== base.origin ||
    !request.pathname.startsWith(prefix) ||
    request.hash
  ) {
    throw new CredentialTargetError();
  }
  return request.href;
}

export interface PreviewCredential {
  previewId: string;
  slug: string;
  ownerToken: string;
  apiUrl: string;
  title?: string;
  updatedAt: string;
}

export interface GlobalConfig {
  apiUrl?: string;
  previews: Record<string, PreviewCredential>;
}

/** Records which preview a project publishes to. Safe to commit — no secrets. */
export interface ProjectLink {
  previewId: string;
  slug: string;
  apiUrl: string;
  shareUrl?: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'liha');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<GlobalConfig>;
    return { apiUrl: parsed.apiUrl, previews: parsed.previews ?? {} };
  } catch {
    return { previews: {} };
  }
}

/**
 * Owner tokens are credentials, so the config file is written with 0600 and
 * lives outside the project tree — never next to the source that gets committed.
 */
export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function rememberPreview(credential: PreviewCredential): Promise<void> {
  const config = await readGlobalConfig();
  config.previews[credential.previewId] = credential;
  await writeGlobalConfig(config);
}

export async function forgetPreview(previewId: string): Promise<void> {
  const config = await readGlobalConfig();
  delete config.previews[previewId];
  await writeGlobalConfig(config);
}

export async function findCredential(idOrSlug: string): Promise<PreviewCredential | null> {
  const config = await readGlobalConfig();
  const direct = config.previews[idOrSlug];
  if (direct) return direct;
  return Object.values(config.previews).find((entry) => entry.slug === idOrSlug) ?? null;
}

/** Walks up from `startDir` looking for a `.liha.json`, like git does for `.git`. */
export function findProjectLinkPath(startDir = process.cwd()): string | null {
  let current = resolve(startDir);
  for (let depth = 0; depth < 30; depth += 1) {
    const candidate = join(current, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function readProjectLink(startDir?: string): Promise<ProjectLink | null> {
  const path = findProjectLinkPath(startDir);
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProjectLink;
  } catch {
    return null;
  }
}

export async function writeProjectLink(link: ProjectLink, dir = process.cwd()): Promise<string> {
  const path = join(resolve(dir), PROJECT_FILE);
  await writeFile(path, `${JSON.stringify(link, null, 2)}\n`);
  return path;
}
