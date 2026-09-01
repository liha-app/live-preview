import type {
  Comment,
  CommentFilter,
  CommentTarget,
  CreatePreviewResult,
  Preview,
  ReviewSummary,
  ShareInfo,
  Version,
} from '@liha/shared';
import { ownerTokens, reviewSessions } from './storage.js';

export const API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'
).replace(/\/$/, '');

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get needsPassword(): boolean {
    return this.code === 'password_required' || this.code === 'invalid_password';
  }

  /** The request never reached the API — offline, DNS, CORS, server down. */
  get isNetworkError(): boolean {
    return this.code === 'network_error';
  }
}

interface RequestOptions {
  method?: string;
  slug?: string;
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.slug) {
    const owner = ownerTokens.get(options.slug);
    if (owner) headers['x-liha-owner-token'] = owner;
    const session = reviewSessions.get(options.slug);
    if (session) headers['x-liha-review-session'] = session;
  }
  if (options.json !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      signal: options.signal ?? null,
    });
  } catch (cause) {
    // A rejected fetch means the request never arrived. Reporting that as a
    // missing preview would tell a reviewer their link is dead when the server
    // is simply unreachable.
    throw new ApiClientError(0, 'network_error', `Could not reach the Liha API at ${API_URL}.`, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!response.ok) {
    let code = 'internal_error';
    let message = `Request failed with HTTP ${response.status}.`;
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
      /* non-JSON error body */
    }
    throw new ApiClientError(response.status, code, message, details);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface UploadPart {
  path: string;
  file: File | Blob;
}

function uploadForm(parts: UploadPart[], fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') form.append(key, value);
  }
  for (const part of parts) {
    const name = part.path.split('/').pop() ?? 'file';
    form.append('files', part.file instanceof File ? part.file : new File([part.file], name));
  }
  form.append('paths', JSON.stringify(parts.map((part) => part.path)));
  return form;
}

export const api = {
  createPreview(parts: UploadPart[], fields: { title?: string; password?: string }) {
    return request<CreatePreviewResult>('/api/previews', {
      method: 'POST',
      body: uploadForm(parts, { ...fields, source: 'web' }),
    });
  },

  /** Mints a sample preview, seeded with review threads, for first-time visitors. */
  createDemoPreview() {
    return request<CreatePreviewResult>('/api/previews/demo', { method: 'POST' });
  },

  createPreviewFromUrl(input: { url: string; title?: string; password?: string }) {
    return request<CreatePreviewResult>('/api/previews/url', { method: 'POST', json: input });
  },

  getPreview(slug: string) {
    return request<{ preview: Preview; isOwner: boolean }>(`/api/previews/${slug}`, { slug });
  },

  getSummary(slug: string) {
    return request<ReviewSummary>(`/api/previews/${slug}/summary`, { slug });
  },

  getShareInfo(slug: string) {
    return request<{ share: ShareInfo }>(`/api/previews/${slug}/share`, { slug });
  },

  updatePreview(slug: string, input: { title?: string; password?: string | null }) {
    return request<{ preview: Preview }>(`/api/previews/${slug}`, {
      method: 'PATCH',
      slug,
      json: input,
    });
  },

  deletePreview(slug: string) {
    return request<{ deleted: boolean }>(`/api/previews/${slug}`, { method: 'DELETE', slug });
  },

  listVersions(slug: string) {
    return request<{ versions: Version[] }>(`/api/previews/${slug}/versions`, { slug });
  },

  addVersion(slug: string, parts: UploadPart[], label?: string) {
    return request<{ preview: Preview; version: Version }>(`/api/previews/${slug}/versions`, {
      method: 'POST',
      slug,
      body: uploadForm(parts, { label, source: 'web' }),
    });
  },

  setCurrentVersion(slug: string, versionId: string) {
    return request<{ preview: Preview; version: Version }>(
      `/api/previews/${slug}/current-version`,
      { method: 'POST', slug, json: { versionId } },
    );
  },

  listComments(slug: string, status: CommentFilter = 'all') {
    return request<{
      comments: Comment[];
      counts: { open: number; resolved: number; total: number };
    }>(`/api/previews/${slug}/comments?status=${status}`, { slug });
  },

  getComment(slug: string, commentId: string) {
    return request<{ comment: Comment }>(`/api/previews/${slug}/comments/${commentId}`, { slug });
  },

  addComment(
    slug: string,
    input: {
      body: string;
      authorName?: string;
      /** Set by the tool layer, so an agent's contribution reads as one. */
      authorKind?: 'human' | 'agent';
      target?: CommentTarget;
      versionId?: string;
      /** Reply into this thread instead of starting a new one. */
      parentId?: string;
    },
  ) {
    return request<{ comment: Comment }>(`/api/previews/${slug}/comments`, {
      method: 'POST',
      slug,
      json: input,
    });
  },

  resolveComment(slug: string, commentId: string, resolvedBy?: string) {
    return request<{ comment: Comment }>(`/api/previews/${slug}/comments/${commentId}/resolve`, {
      method: 'POST',
      slug,
      json: { resolvedBy },
    });
  },

  reopenComment(slug: string, commentId: string) {
    return request<{ comment: Comment }>(`/api/previews/${slug}/comments/${commentId}/reopen`, {
      method: 'POST',
      slug,
      json: {},
    });
  },

  async authenticate(slug: string, password: string) {
    const result = await request<{ reviewSession: string | null; expiresAt?: string }>(
      `/api/previews/${slug}/auth`,
      { method: 'POST', slug, json: { password } },
    );
    if (result.reviewSession) reviewSessions.set(slug, result.reviewSession);
    return result;
  },
};
