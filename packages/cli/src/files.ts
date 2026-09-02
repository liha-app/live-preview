import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { LIMITS, formatBytes, sanitizeRelativePath } from '@liha-cli/shared';
import { CliError, EXIT } from './output.js';
import type { LocalFile } from './client.js';

/** Never uploaded, whatever the user points us at. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  '.turbo',
  '.next/cache',
  '__MACOSX',
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function isIgnored(name: string): boolean {
  if (IGNORED_DIRECTORIES.has(name) || IGNORED_FILES.has(name)) return true;
  // Dotfiles are almost always config or secrets, not published assets.
  return name.startsWith('.') && name !== '.well-known';
}

export async function collectFiles(target: string): Promise<LocalFile[]> {
  const absolute = resolve(target);
  if (!existsSync(absolute)) {
    throw new CliError(`No such file or directory: ${target}`, EXIT.usage, 'missing_path');
  }
  const info = await stat(absolute);

  if (info.isFile()) {
    return [
      { path: posix(absolute.split(sep).pop() ?? 'file'), absolutePath: absolute, size: info.size },
    ];
  }

  const files: LocalFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isIgnored(entry.name)) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        const childInfo = await stat(child);
        files.push({
          path: posix(relative(absolute, child)),
          absolutePath: child,
          size: childInfo.size,
        });
      }
    }
    if (files.length > LIMITS.maxFiles) {
      throw new CliError(
        `That directory contains more than ${LIMITS.maxFiles} files.`,
        EXIT.usage,
        'too_many_files',
      );
    }
  };
  await walk(absolute);

  if (files.length === 0) {
    throw new CliError(`${target} contains no files to upload.`, EXIT.usage, 'empty_directory');
  }
  return files;
}

const posix = (path: string) => path.split(sep).join('/');

export function assertUploadable(files: LocalFile[], maxBytes = LIMITS.maxVersionBytes): void {
  for (const file of files) {
    try {
      sanitizeRelativePath(file.path);
    } catch (error) {
      throw new CliError(
        `Cannot upload "${file.path}": ${(error as Error).message}`,
        EXIT.usage,
        'invalid_path',
      );
    }
    if (file.size > LIMITS.maxFileBytes) {
      throw new CliError(
        `"${file.path}" is ${formatBytes(file.size)}, over the ${formatBytes(LIMITS.maxFileBytes)} per-file limit.`,
        EXIT.usage,
        'file_too_large',
      );
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > maxBytes) {
    throw new CliError(
      `Upload is ${formatBytes(total)}, over the ${formatBytes(maxBytes)} limit per version.`,
      EXIT.usage,
      'upload_too_large',
    );
  }
}

export function totalBytes(files: LocalFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}
