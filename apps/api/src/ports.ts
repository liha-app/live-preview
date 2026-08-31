/**
 * Structural subsets of the Cloudflare D1 and R2 bindings.
 *
 * The app is written against these ports so the exact same route code runs on
 * Workers (real D1/R2) and in tests (node:sqlite + an in-memory bucket). The
 * shapes intentionally mirror the Cloudflare API so the real bindings satisfy
 * them without an adapter.
 */

export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  prepare(query: string): PreparedStatement;
}

export interface StoredObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly size: number;
  readonly httpMetadata?: { contentType?: string };
}

export interface ObjectStore {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<StoredObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}
