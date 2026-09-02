import { describe, expect, it, vi } from 'vitest';
import { buildTools } from './tools.js';
import type { LihaWebMcpHost } from './host.js';

/*
 * The published set, pinned.
 *
 * These names are documented — in the README's table and in the submission —
 * and a count written out in prose drifts the moment a tool is added. Adding
 * one fails here, so whoever adds it goes and updates what says how many there
 * are.
 */
const HOST: LihaWebMcpHost = {
  getPreview: () => null,
  getShareInfo: () => null,
  getVersions: () => [],
  getComments: () => [],
  isOwner: () => false,
  addComment: vi.fn(),
  resolveComment: vi.fn(),
  listArtifactFiles: () => [],
  readArtifactFile: vi.fn(),
  focusComment: vi.fn(),
  setViewport: vi.fn(),
} as unknown as LihaWebMcpHost;

const REVIEW_TOOLS = [
  'get_preview_info',
  'get_share_info',
  'list_comments',
  'get_comment',
  'add_comment',
  'resolve_comment',
  'list_versions',
  'get_review_summary',
  'focus_comment',
  'set_viewport',
  'list_artifact_files',
  'read_artifact_file',
];

describe('what a page publishes', () => {
  it('is exactly this set, in this order', () => {
    expect(buildTools(HOST).map((tool) => tool.name)).toEqual(REVIEW_TOOLS);
  });

  /*
   * Publishing a tool the host cannot answer would be a lie to the agent, so
   * this one appears only where somebody can act on it.
   */
  it('adds the thirteenth only where the host can do it', () => {
    const withCreate = { ...HOST, createPreviewFromUrl: vi.fn() } as unknown as LihaWebMcpHost;
    expect(buildTools(withCreate).map((tool) => tool.name)).toEqual([
      ...REVIEW_TOOLS,
      'create_preview_from_url',
    ]);
  });

  it('describes every one of them, and says what each takes', () => {
    for (const tool of buildTools(HOST)) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema, tool.name).toBeTruthy();
    }
  });
});
