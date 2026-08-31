import type { UploadPart } from './api.js';

export interface UploadSelection {
  parts: UploadPart[];
  totalBytes: number;
}

function toSelection(parts: UploadPart[]): UploadSelection {
  return {
    parts,
    totalBytes: parts.reduce((total, part) => total + part.file.size, 0),
  };
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file(callback: (file: File) => void, error: (error: unknown) => void): void;
  createReader(): {
    readEntries(
      callback: (entries: FileSystemEntryLike[]) => void,
      error: (error: unknown) => void,
    ): void;
  };
}

/** `readEntries` returns at most 100 entries per call, so it has to be drained. */
function readAllEntries(reader: ReturnType<FileSystemEntryLike['createReader']>) {
  return new Promise<FileSystemEntryLike[]>((resolve, reject) => {
    const all: FileSystemEntryLike[] = [];
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
          return;
        }
        all.push(...entries);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntryLike, prefix: string): Promise<UploadPart[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [{ path: `${prefix}${file.name}`, file }];
  }
  if (!entry.isDirectory) return [];
  const entries = await readAllEntries(entry.createReader());
  const parts: UploadPart[] = [];
  for (const child of entries) {
    parts.push(...(await walkEntry(child, `${prefix}${dirName(entry)}/`)));
  }
  return parts;
}

function dirName(entry: FileSystemEntryLike): string {
  const segments = entry.fullPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/** Accepts dropped files and dropped folders (Chromium, Safari and Firefox). */
export async function filesFromDataTransfer(transfer: DataTransfer): Promise<UploadSelection> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .map((item) =>
      (
        item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null }
      ).webkitGetAsEntry?.(),
    )
    .filter((entry): entry is FileSystemEntryLike => Boolean(entry));

  if (entries.length > 0) {
    const parts: UploadPart[] = [];
    for (const entry of entries) {
      parts.push(...(await walkEntry(entry, '')));
    }
    if (parts.length > 0) return toSelection(parts);
  }

  return toSelection(
    Array.from(transfer.files).map((file) => ({ path: relativePathOf(file), file })),
  );
}

function relativePathOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

export function pickFiles(options: { directory: boolean }): Promise<UploadSelection | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (options.directory) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      resolve(
        files.length === 0
          ? null
          : toSelection(files.map((file) => ({ path: relativePathOf(file), file }))),
      );
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
