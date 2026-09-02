import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  Comment,
  CommentFilter,
  CreatePreviewResult,
  Preview,
  ReviewSummary,
  ShareInfo,
  Version,
} from '@liha-cli/shared';
import { CliError, EXIT } from './output.js';

export interface ClientOptions {
  apiUrl: string;
  ownerToken?: string;
  reviewSession?: string;
}

export interface LocalFile {
  /** Path inside the preview, POSIX separators, relative to the upload root. */
  path: string;
  /** Absolute path on disk. */
  absolutePath: string;
  size: number;
}

const EXIT_BY_STATUS: Record<number, (typeof EXIT)[keyof typeof EXIT]> = {
  400: EXIT.usage,
  401: EXIT.auth,
  403: EXIT.auth,
  404: EXIT.notFound,
  409: EXIT.conflict,
  413: EXIT.usage,
  415: EXIT.usage,
  429: EXIT.error,
};

/**
 * Node's `Buffer` is a view onto a pooled ArrayBuffer, so it is re-wrapped as a
 * plain Uint8Array view (no copy) to satisfy the standard BlobPart type. The
 * cast is safe: `fs.readFile` never returns a SharedArrayBuffer-backed buffer.
 */
function asBlobPart(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

export class LihaClient {
  constructor(private readonly options: ClientOptions) {}

  get apiUrl(): string {
    return this.options.apiUrl;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.options.ownerToken) headers['x-liha-owner-token'] = this.options.ownerToken;
    if (this.options.reviewSession) headers['x-liha-review-session'] = this.options.reviewSession;
    return headers;
  }

  private async request<T>(
    path: string,
    init: { method?: string; json?: unknown; body?: FormData } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.options.apiUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: this.headers(
          init.json !== undefined ? { 'content-type': 'application/json' } : {},
        ),
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
    } catch (cause) {
      throw new CliError(
        `Could not reach the Liha API at ${this.options.apiUrl}. Is it running?`,
        EXIT.error,
        'network_error',
        { cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }

    if (!response.ok) {
      let code = 'http_error';
      let message = `The API returned HTTP ${response.status}.`;
      let details: unknown;
      try {
        const body = (await response.json()) as {
          error?: { code: string; message: string; details?: unknown };
        };
        if (body.error) {
          code = body.error.code;
          message = body.error.message;
          details = body.error.details;
        }
      } catch {
        /* not a JSON error body */
      }
      throw new CliError(message, EXIT_BY_STATUS[response.status] ?? EXIT.error, code, details);
    }
    return (await response.json()) as T;
  }

  private async buildForm(
    files: LocalFile[],
    fields: Record<string, string | undefined>,
  ): Promise<FormData> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== '') form.append(key, value);
    }
    for (const file of files) {
      const bytes = await readFile(file.absolutePath);
      form.append('files', new File([asBlobPart(bytes)], basename(file.path)));
    }
    form.append('paths', JSON.stringify(files.map((file) => file.path)));
    return form;
  }

  async createPreview(
    files: LocalFile[],
    fields: { title?: string; password?: string; label?: string },
  ): Promise<CreatePreviewResult> {
    return this.request('/api/previews', {
      method: 'POST',
      body: await this.buildForm(files, { ...fields, source: 'cli' }),
    });
  }

  async addVersion(
    slug: string,
    files: LocalFile[],
    label?: string,
  ): Promise<{ preview: Preview; version: Version }> {
    return this.request(`/api/previews/${slug}/versions`, {
      method: 'POST',
      body: await this.buildForm(files, { label, source: 'cli' }),
    });
  }

  getPreview(slug: string) {
    return this.request<{ preview: Preview; isOwner: boolean }>(`/api/previews/${slug}`);
  }

  getSummary(slug: string) {
    return this.request<ReviewSummary>(`/api/previews/${slug}/summary`);
  }

  getShare(slug: string) {
    return this.request<{ share: ShareInfo }>(`/api/previews/${slug}/share`);
  }

  listVersions(slug: string) {
    return this.request<{ versions: Version[] }>(`/api/previews/${slug}/versions`);
  }

  setCurrentVersion(slug: string, versionId: string) {
    return this.request<{ preview: Preview; version: Version }>(
      `/api/previews/${slug}/current-version`,
      { method: 'POST', json: { versionId } },
    );
  }

  listComments(slug: string, status: CommentFilter) {
    return this.request<{
      comments: Comment[];
      counts: { open: number; resolved: number; total: number };
    }>(`/api/previews/${slug}/comments?status=${status}`);
  }

  getComment(slug: string, commentId: string) {
    return this.request<{ comment: Comment }>(`/api/previews/${slug}/comments/${commentId}`);
  }

  addComment(slug: string, input: { body: string; authorName?: string; parentId?: string }) {
    return this.request<{ comment: Comment }>(`/api/previews/${slug}/comments`, {
      method: 'POST',
      json: input,
    });
  }

  resolveComment(slug: string, commentId: string, resolvedBy?: string) {
    return this.request<{ comment: Comment }>(
      `/api/previews/${slug}/comments/${commentId}/resolve`,
      { method: 'POST', json: { resolvedBy } },
    );
  }

  deletePreview(slug: string) {
    return this.request<{ deleted: boolean }>(`/api/previews/${slug}`, { method: 'DELETE' });
  }

  updatePreview(slug: string, input: { title?: string; password?: string | null }) {
    return this.request<{ preview: Preview }>(`/api/previews/${slug}`, {
      method: 'PATCH',
      json: input,
    });
  }

  authenticate(slug: string, password: string) {
    return this.request<{ reviewSession: string | null }>(`/api/previews/${slug}/auth`, {
      method: 'POST',
      json: { password },
    });
  }
}
