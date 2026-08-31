import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/app.js';
import type { Env } from '../src/env.js';
import type { Database, ObjectStore, PreparedStatement, StoredObjectBody } from '../src/ports.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * D1 adapter over node:sqlite.
 *
 * Tests run the *real* migrations and the *real* SQL, just against a local
 * SQLite file instead of D1. That keeps integration tests fast and deterministic
 * while still exercising the queries that ship.
 */
function createSqliteDatabase(): Database {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  const normalize = (row: unknown) =>
    row === undefined ? null : ({ ...(row as object) } as never);

  const makeStatement = (query: string, params: unknown[]): PreparedStatement => ({
    bind: (...values: unknown[]) => makeStatement(query, values),
    async first<T>() {
      const statement = db.prepare(query);
      return normalize(statement.get(...(params as never[]))) as T | null;
    },
    async all<T>() {
      const statement = db.prepare(query);
      const rows = statement.all(...(params as never[])) as unknown[];
      return { results: rows.map((row) => ({ ...(row as object) })) as T[] };
    },
    async run() {
      return db.prepare(query).run(...(params as never[]));
    },
  });

  return { prepare: (query: string) => makeStatement(query, []) };
}

interface StoredEntry {
  bytes: Uint8Array;
  contentType?: string;
}

/** Minimal in-memory stand-in for an R2 bucket. */
export function createMemoryBucket(): ObjectStore & { snapshot(): Map<string, StoredEntry> } {
  const store = new Map<string, StoredEntry>();

  return {
    snapshot: () => store,
    async put(key, value, options) {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      store.set(key, {
        bytes: new Uint8Array(bytes),
        contentType: options?.httpMetadata?.contentType,
      });
    },
    async get(key): Promise<StoredObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        size: entry.bytes.length,
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return entry.bytes.slice().buffer;
        },
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    async list({ prefix = '', limit = 1000 }) {
      const objects = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((key) => ({ key }));
      return { objects, truncated: false };
    },
  };
}

export const API_ORIGIN = 'http://api.test';

export interface TestServer {
  env: Env;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  fetchAbsolute(url: string, init?: RequestInit): Promise<Response>;
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export function createTestServer(overrides: Partial<Env> = {}): TestServer {
  const env: Env = {
    DB: createSqliteDatabase(),
    BUCKET: createMemoryBucket(),
    APP_ORIGIN: 'http://app.test',
    CONTENT_ORIGIN_TEMPLATE: 'http://{label}.content.test',
    CONTENT_SIGNING_KEY: 'test-signing-key',
    ...overrides,
  };

  const fetchAbsolute = (url: string, init?: RequestInit) =>
    handleRequest(new Request(url, init) as unknown as Request, env);

  return {
    env,
    fetchAbsolute,
    fetch: (path, init) => fetchAbsolute(`${API_ORIGIN}${path}`, init),
    async json<T>(path: string, init?: RequestInit) {
      const response = await fetchAbsolute(`${API_ORIGIN}${path}`, init);
      return (await response.json()) as T;
    },
  };
}

export interface UploadFile {
  path: string;
  content: string | Uint8Array;
  type?: string;
}

/** Builds the multipart body the web app and CLI both send. */
export function uploadBody(
  files: UploadFile[],
  fields: Record<string, string> = {},
): { body: FormData } {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    const bytes =
      typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    form.append(
      'files',
      new File([bytes as unknown as Blob], file.path.split('/').pop() ?? 'file', {
        type: file.type ?? 'application/octet-stream',
      }),
    );
  }
  form.append('paths', JSON.stringify(files.map((file) => file.path)));
  return { body: form };
}

export const ownerHeaders = (token: string) => ({ 'x-liha-owner-token': token });

/** A 1x1 PNG, used wherever a test needs real image bytes. */
export const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/**
 * Runs the Worker app behind a real HTTP listener.
 *
 * Used by the CLI and MCP test suites, which exercise their own HTTP clients
 * and therefore need a socket rather than an in-process fetch handler.
 */
export async function startTestServer(
  env: Env = createTestServer().env,
): Promise<{ url: string; env: Env; close(): Promise<void> }> {
  const { createServer } = await import('node:http');

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
        method: incoming.method,
        headers,
        body: body as unknown as BodyInit | undefined,
        // Node requires this when streaming a body into a Request.
        ...(body ? { duplex: 'half' } : {}),
      } as RequestInit);

      const response = await handleRequest(request as unknown as Request, env);
      const payload = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(payload);
    })().catch((error: unknown) => {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    env,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
