import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CliError, EXIT } from './output.js';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCK_FILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** Directories bundlers conventionally emit into, most specific first. */
const OUTPUT_CANDIDATES = [
  'dist',
  'build',
  'out',
  '.output/public',
  '.svelte-kit/output/client',
  'public',
  '_site',
];

export interface ProjectInfo {
  root: string;
  packageJson: Record<string, unknown> | null;
  packageManager: PackageManager | null;
  buildScript: string | null;
  name: string | null;
}

export async function inspectProject(dir: string): Promise<ProjectInfo> {
  const root = resolve(dir);
  const packageJsonPath = join(root, 'package.json');

  let packageJson: Record<string, unknown> | null = null;
  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new CliError(
        `${packageJsonPath} is not valid JSON.`,
        EXIT.usage,
        'invalid_package_json',
      );
    }
  }

  const scripts = (packageJson?.scripts ?? {}) as Record<string, string>;
  return {
    root,
    packageJson,
    packageManager: detectPackageManager(root),
    buildScript: typeof scripts.build === 'string' ? scripts.build : null,
    name: typeof packageJson?.name === 'string' ? packageJson.name : null,
  };
}

export function detectPackageManager(root: string): PackageManager | null {
  for (const [lockFile, manager] of LOCK_FILES) {
    if (existsSync(join(root, lockFile))) return manager;
  }
  return existsSync(join(root, 'package.json')) ? 'npm' : null;
}

export function buildCommandFor(manager: PackageManager): [string, string[]] {
  if (manager === 'npm') return ['npm', ['run', 'build']];
  if (manager === 'yarn') return ['yarn', ['build']];
  if (manager === 'bun') return ['bun', ['run', 'build']];
  return ['pnpm', ['run', 'build']];
}

export function detectOutputDir(root: string): string | null {
  for (const candidate of OUTPUT_CANDIDATES) {
    const path = join(root, candidate);
    if (existsSync(path) && existsSync(join(path, 'index.html'))) return path;
  }
  // Fall back to a directory that exists even without an index.html, so a
  // single-page artifact with a different entry name is still deployable.
  for (const candidate of OUTPUT_CANDIDATES) {
    const path = join(root, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Runs the project's build. Child stdout is forwarded to *stderr* so it can
 * never contaminate this CLI's own stdout contract.
 */
export function runBuild(
  command: string,
  args: string[],
  cwd: string,
  onOutput: (chunk: string) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    child.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
    child.on('error', (error) =>
      reject(
        new CliError(
          `Could not run "${command} ${args.join(' ')}": ${error.message}`,
          EXIT.error,
          'build_failed',
        ),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new CliError(
            `Build failed: "${command} ${args.join(' ')}" exited with code ${code}.`,
            EXIT.error,
            'build_failed',
          ),
        );
    });
  });
}

export function parseCommandLine(commandLine: string): [string, string[]] {
  const parts = commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const cleaned = parts.map((part) => part.replace(/^["']|["']$/g, ''));
  if (cleaned.length === 0) {
    throw new CliError('--build-command cannot be empty.', EXIT.usage, 'usage');
  }
  return [cleaned[0]!, cleaned.slice(1)];
}
