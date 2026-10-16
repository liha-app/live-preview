import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTarget } from './context.js';
import { DEFAULT_API_URL, rememberPreview, writeGlobalConfig, writeProjectLink } from './config.js';
import { LihaClient } from './client.js';
import type { ParsedArgs } from './args.js';

const API = 'https://api-a.example.test/service';
const OTHER_API = 'https://api-b.example.test/service';
const TOKEN = 'synthetic-owner-credential';
const originalCwd = process.cwd();
let fixture: string;

const args = (flags: Record<string, string> = {}): ParsedArgs => ({
  command: 'info',
  positionals: [],
  flags: new Map(Object.entries(flags)),
});

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'liha-credential-scope-'));
  vi.stubEnv('XDG_CONFIG_HOME', fixture);
  vi.stubEnv('LIHA_API_URL', undefined);
  vi.stubEnv('LIHA_OWNER_TOKEN', undefined);
  vi.stubEnv('LIHA_PREVIEW', undefined);
  process.chdir(fixture);
  await writeProjectLink({ previewId: 'pv_fixture', slug: 'fixture', apiUrl: API });
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(fixture, { recursive: true, force: true });
});

async function saveCredential() {
  await rememberPreview({
    previewId: 'pv_fixture',
    slug: 'fixture',
    apiUrl: API,
    ownerToken: TOKEN,
    updatedAt: new Date().toISOString(),
  });
}

describe('CLI credential destination', () => {
  it('uses the saved credential only on its matching API', async () => {
    await saveCredential();
    const target = await resolveTarget(args());
    expect(target.apiUrl).toBe(API);
    expect(target.ownerToken).toBe(TOKEN);
  });

  it('rejects project API changes before making a request', async () => {
    await saveCredential();
    await writeProjectLink({ previewId: 'pv_fixture', slug: 'fixture', apiUrl: OTHER_API });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    await expect(resolveTarget(args())).rejects.toMatchObject({ code: 'credential_api_mismatch' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retarget a saved credential through an explicit API option', async () => {
    await saveCredential();
    await expect(resolveTarget(args({ api: OTHER_API }))).rejects.toMatchObject({
      code: 'credential_api_mismatch',
    });
  });

  it('requires an explicit API binding on a saved credential', async () => {
    await writeGlobalConfig(
      JSON.parse(
        JSON.stringify({
          previews: {
            pv_fixture: { previewId: 'pv_fixture', slug: 'fixture', ownerToken: TOKEN },
          },
        }),
      ),
    );
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    await expect(resolveTarget(args({ api: DEFAULT_API_URL }))).rejects.toMatchObject({
      code: 'credential_api_mismatch',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps environment credentials bound to their environment API', async () => {
    vi.stubEnv('LIHA_OWNER_TOKEN', TOKEN);
    vi.stubEnv('LIHA_API_URL', API);
    await expect(resolveTarget(args({ api: OTHER_API }))).rejects.toMatchObject({
      code: 'credential_api_mismatch',
    });
    expect((await resolveTarget(args())).apiUrl).toBe(API);
  });

  it('requires an API binding for a custom environment credential', async () => {
    vi.stubEnv('LIHA_OWNER_TOKEN', TOKEN);
    await expect(resolveTarget(args())).rejects.toMatchObject({ code: 'credential_api_mismatch' });
  });

  it('accepts an explicitly supplied token with its explicitly selected API', async () => {
    const target = await resolveTarget(args({ api: OTHER_API, token: TOKEN }));
    expect(target.apiUrl).toBe(OTHER_API);
    expect(target.ownerToken).toBe(TOKEN);
  });

  it('uses the stored slug rather than a changed project slug', async () => {
    await saveCredential();
    await writeProjectLink({ previewId: 'pv_fixture', slug: 'different', apiUrl: API });
    expect((await resolveTarget(args())).slug).toBe('fixture');
  });

  it('continues to allow unauthenticated public project links', async () => {
    const target = await resolveTarget(args());
    expect(target.apiUrl).toBe(API);
    expect(target.ownerToken).toBeUndefined();
  });

  it('does not follow redirects when carrying API credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ preview: {} }));
    await new LihaClient({ apiUrl: API, ownerToken: TOKEN }).getPreview('fixture');
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/previews/fixture`,
      expect.objectContaining({ redirect: 'error', headers: { 'x-liha-owner-token': TOKEN } }),
    );
  });

  it.each(['../outside', 'bad?query', '%2e%2e', 'bad\\route'])(
    'rejects route syntax in identifiers before request (%s)',
    (identifier) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
      const client = new LihaClient({ apiUrl: API, ownerToken: TOKEN });
      expect(() => client.getSummary(identifier)).toThrow();
      expect(() => client.getComment('fixture', identifier)).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
