import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const DEFAULT_API_URL = 'http://localhost:8787';
export const PROJECT_FILE = '.liha.json';

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
