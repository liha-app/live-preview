import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer, type McpServerOptions } from './server.js';
import {
  DEFAULT_API_URL,
  rememberPreview,
  writeGlobalConfig,
  writeProjectLink,
} from './credentials.js';
import { LihaApi } from './api.js';

const API = 'https://api-a.example.test';
const OTHER_API = 'https://api-b.example.test';
const TOKEN = 'synthetic-owner-credential';
let fixture: string;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'liha-mcp-scope-'));
  vi.stubEnv('XDG_CONFIG_HOME', fixture);
  vi.stubEnv('LIHA_OWNER_TOKEN', undefined);
  vi.stubEnv('LIHA_API_URL', undefined);
  await writeProjectLink({ previewId: 'pv_fixture', slug: 'fixture', apiUrl: API }, fixture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(fixture, { recursive: true, force: true });
});

async function info(options: McpServerOptions = {}) {
  const server = await createMcpServer({ ...options, projectRoot: fixture });
  const client = new Client({ name: 'scope-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name: 'get_preview_info', arguments: {} });
  } finally {
    await client.close();
    await server.close();
  }
}

describe('MCP credential destination', () => {
  it('rejects a configured API different from a saved credential before request', async () => {
    await rememberPreview({
      previewId: 'pv_fixture',
      slug: 'fixture',
      apiUrl: API,
      ownerToken: TOKEN,
      updatedAt: new Date().toISOString(),
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const result = await info({ apiUrl: OTHER_API });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not bind an environment token to the project file', async () => {
    vi.stubEnv('LIHA_OWNER_TOKEN', TOKEN);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const result = await info();
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires an explicit API binding on a saved credential', async () => {
    // Model a legacy/incomplete local config without reading the user's store.
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
    const result = await info({ apiUrl: DEFAULT_API_URL });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the matching environment API ahead of project hints', async () => {
    vi.stubEnv('LIHA_OWNER_TOKEN', TOKEN);
    vi.stubEnv('LIHA_API_URL', API);
    await writeProjectLink(
      { previewId: 'pv_fixture', slug: 'fixture', apiUrl: OTHER_API },
      fixture,
    );
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        preview: {},
        versions: [],
        currentVersion: null,
        counts: { open: 0, resolved: 0, total: 0 },
      }),
    );
    const result = await info();
    expect(result.isError).not.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/previews/fixture/summary`,
      expect.objectContaining({ redirect: 'error', headers: { 'x-liha-owner-token': TOKEN } }),
    );
  });

  it('forbids redirects in the MCP API client', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
    await new LihaApi({ apiUrl: API, ownerToken: TOKEN }).getSummary('fixture');
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it.each(['../outside', 'bad?query', '%2e%2e', 'bad\\route'])(
    'rejects route syntax in identifiers before request (%s)',
    (identifier) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
      const api = new LihaApi({ apiUrl: `${API}/service`, ownerToken: TOKEN });
      expect(() => api.getSummary(identifier)).toThrow();
      expect(() => api.getComment('fixture', identifier)).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
