import { basename } from 'node:path';
import type {
  Comment,
  CommentFilter,
  CreatePreviewResult,
  Preview,
  ReviewSummary,
  Version,
} from '@liha-cli/shared';
import type { Workspace, WorkspaceFile } from './workspace.js';
import { apiPathSegment, apiRequestUrl, credentialRequestApiUrl } from './credentials.js';

/**
 * Node's `Buffer` is a view onto a pooled ArrayBuffer, so it is re-wrapped as a
 * plain Uint8Array view (no copy) to satisfy the standard BlobPart type. The
 * cast is safe: `fs.readFile` never returns a SharedArrayBuffer-backed buffer.
 */
function asBlobPart(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  apiUrl: string;
  ownerToken?: string;
}

export class LihaApi {
  private readonly options: ApiOptions;

  constructor(options: ApiOptions) {
    this.options = {
      ...options,
      apiUrl: credentialRequestApiUrl(options.apiUrl, Boolean(options.ownerToken)),
    };
  }

  get apiUrl(): string {
    return this.options.apiUrl;
  }

  withToken(ownerToken: string | undefined): LihaApi {
    return new LihaApi({ ...this.options, ownerToken });
  }

  private async request<T>(
    path: string,
    init: { method?: string; json?: unknown; body?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.options.ownerToken) headers['x-liha-owner-token'] = this.options.ownerToken;
    if (init.json !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(apiRequestUrl(this.options.apiUrl, path), {
      redirect: 'error',
      method: init.method ?? 'GET',
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });

    if (!response.ok) {
      let code = 'http_error';
      let message = `The Liha API returned HTTP ${response.status}.`;
      try {
        const body = (await response.json()) as { error?: { code: string; message: string } };
        if (body.error) {
          code = body.error.code;
          message = body.error.message;
        }
      } catch {
        /* not JSON */
      }
      throw new ApiError(message, code, response.status);
    }
    return (await response.json()) as T;
  }

  private async form(
    workspace: Workspace,
    files: WorkspaceFile[],
    fields: Record<string, string | undefined>,
  ): Promise<FormData> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== '') form.append(key, value);
    }
    for (const file of files) {
      const bytes = await workspace.read(file);
      form.append('files', new File([asBlobPart(bytes)], basename(file.path)));
    }
    form.append('paths', JSON.stringify(files.map((file) => file.path)));
    return form;
  }

  async createPreview(
    workspace: Workspace,
    files: WorkspaceFile[],
    fields: { title?: string; password?: string },
  ): Promise<CreatePreviewResult> {
    return this.request('/api/previews', {
      method: 'POST',
      body: await this.form(workspace, files, { ...fields, source: 'mcp' }),
    });
  }

  async addVersion(
    workspace: Workspace,
    slug: string,
    files: WorkspaceFile[],
    label?: string,
  ): Promise<{ preview: Preview; version: Version }> {
    return this.request(`/api/previews/${apiPathSegment(slug)}/versions`, {
      method: 'POST',
      body: await this.form(workspace, files, { label, source: 'mcp' }),
    });
  }

  getSummary(slug: string) {
    return this.request<ReviewSummary>(`/api/previews/${apiPathSegment(slug)}/summary`);
  }

  getPreview(slug: string) {
    return this.request<{ preview: Preview; isOwner: boolean }>(
      `/api/previews/${apiPathSegment(slug)}`,
    );
  }

  listVersions(slug: string) {
    return this.request<{ versions: Version[] }>(`/api/previews/${apiPathSegment(slug)}/versions`);
  }

  listComments(slug: string, status: CommentFilter) {
    return this.request<{
      comments: Comment[];
      counts: { open: number; resolved: number; total: number };
    }>(`/api/previews/${apiPathSegment(slug)}/comments?status=${status}`);
  }

  getComment(slug: string, commentId: string) {
    return this.request<{ comment: Comment }>(
      `/api/previews/${apiPathSegment(slug)}/comments/${apiPathSegment(commentId)}`,
    );
  }

  addComment(
    slug: string,
    input: {
      body: string;
      authorName?: string;
      parentId?: string;
      authorKind?: 'human' | 'agent';
    },
  ) {
    return this.request<{ comment: Comment }>(`/api/previews/${apiPathSegment(slug)}/comments`, {
      method: 'POST',
      json: input,
    });
  }

  resolveComment(slug: string, commentId: string) {
    return this.request<{ comment: Comment }>(
      `/api/previews/${apiPathSegment(slug)}/comments/${apiPathSegment(commentId)}/resolve`,
      { method: 'POST', json: { resolvedBy: 'coding agent (MCP)' } },
    );
  }
}
