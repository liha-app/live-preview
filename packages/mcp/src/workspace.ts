import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  '.turbo',
  '__MACOSX',
  '.DS_Store',
]);

export interface WorkspaceFile {
  path: string;
  absolutePath: string;
  size: number;
}

/**
 * A rooted view of the filesystem.
 *
 * Every path an agent supplies is resolved against this root and rejected if it
 * lands outside — including via `..`, an absolute path or a symlink. The MCP
 * server never reads a file the operator did not scope it to.
 */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    if (!existsSync(this.root)) {
      throw new WorkspaceError(`Project root does not exist: ${this.root}`);
    }
  }

  /** Resolves `input` inside the root, following symlinks before checking. */
  async resolveInside(input: string): Promise<string> {
    if (typeof input !== 'string' || input.length === 0) {
      throw new WorkspaceError('A path is required.');
    }
    if (input.includes('\0')) throw new WorkspaceError('Path contains a NUL byte.');

    const candidate = isAbsolute(input) ? resolve(input) : resolve(this.root, input);
    // Resolve symlinks so a link pointing outside the root cannot be followed.
    const real = await import('node:fs/promises')
      .then((fs) => fs.realpath(candidate))
      .catch(() => candidate);

    const rootReal = await import('node:fs/promises')
      .then((fs) => fs.realpath(this.root))
      .catch(() => this.root);

    if (real !== rootReal && !real.startsWith(rootReal + sep)) {
      throw new WorkspaceError(
        `Refusing to touch "${input}": it is outside the project root (${this.root}).`,
      );
    }
    return real;
  }

  async collect(input: string): Promise<WorkspaceFile[]> {
    const absolute = await this.resolveInside(input);
    if (!existsSync(absolute)) throw new WorkspaceError(`No such file or directory: ${input}`);

    const info = await stat(absolute);
    if (info.isFile()) {
      return [
        {
          path: absolute.split(sep).pop() ?? 'file',
          absolutePath: absolute,
          size: info.size,
        },
      ];
    }

    const files: WorkspaceFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
        const child = join(dir, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) {
          const childInfo = await stat(child);
          files.push({
            path: relative(absolute, child).split(sep).join('/'),
            absolutePath: child,
            size: childInfo.size,
          });
        }
      }
    };
    await walk(absolute);
    if (files.length === 0) throw new WorkspaceError(`${input} contains no files.`);
    return files;
  }

  read(file: WorkspaceFile): Promise<Buffer> {
    return readFile(file.absolutePath);
  }
}
