import { describe, expect, it } from 'vitest';
import { storeVersionFiles, type PreparedUpload } from '../src/uploads.js';
import type { ObjectStore } from '../src/ports.js';
import { createMemoryBucket } from './harness.js';

/*
 * Files are written concurrently — one at a time meant a second per file
 * against the real bucket, which is three minutes for a 169-file site. The
 * writes may finish in any order; the manifest may not be in any order, since
 * it is what the file list and every path lookup are built from.
 */

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `page-${String(i).padStart(3, '0')}.html`,
    bytes: new TextEncoder().encode(`<p>${i}</p>`),
  }));

const upload = (count: number): PreparedUpload => ({
  kind: 'html',
  entries: entries(count),
  entryPath: 'page-000.html',
  totalBytes: count * 8,
});

/** A bucket whose writes land in reverse, the worst case for ordering. */
function reversingBucket(count: number): ObjectStore {
  const inner = createMemoryBucket();
  let seen = 0;
  return {
    ...inner,
    async put(key, value, options) {
      const mine = seen++;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, count - mine)));
      return inner.put(key, value, options);
    },
  };
}

describe('storing a version', () => {
  it('keeps the manifest in upload order however the writes land', async () => {
    const files = upload(40);
    const manifest = await storeVersionFiles(reversingBucket(40), 'pv_1', 'vs_1', files);

    expect(manifest.files.map((file) => file.path)).toEqual(files.entries.map((e) => e.path));
  });

  it('writes every file exactly once, and the manifest beside them', async () => {
    const bucket = createMemoryBucket();
    await storeVersionFiles(bucket, 'pv_1', 'vs_1', upload(50));

    const keys = [...bucket.snapshot().keys()];
    expect(keys).toHaveLength(51);
    expect(new Set(keys).size).toBe(51);
    expect(keys).toContain('previews/pv_1/versions/vs_1/manifest.json');
  });

  it('does not run every write at once, however many files there are', async () => {
    let inFlight = 0;
    let peak = 0;
    const inner = createMemoryBucket();
    const bucket: ObjectStore = {
      ...inner,
      async put(key, value, options) {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return inner.put(key, value, options);
      },
    };

    await storeVersionFiles(bucket, 'pv_1', 'vs_1', upload(200));

    // Every in-flight write is a subrequest, and a Worker has a budget.
    expect(peak).toBeLessThanOrEqual(16);
    expect(peak).toBeGreaterThan(1);
  });
});
