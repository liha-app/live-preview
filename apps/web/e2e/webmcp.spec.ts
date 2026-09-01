import { expect, test, type Page } from '@playwright/test';
import { skipIntro } from './home.js';

const API = 'http://localhost:8787';

/**
 * Drives the real WebMCP surface in a real browser.
 *
 * A shim stands in for the browser's implementation and — crucially — validates
 * every call against the tool's own published `inputSchema`, the way a real
 * client would. Unit tests against a permissive mock previously hid a live bug
 * where `add_comment` read an argument its schema never declared.
 */
const SHIM = `
window.__liha = { tools: new Map(), calls: [] };
document.modelContext = {
  registerTool(descriptor) {
    window.__liha.tools.set(descriptor.name, descriptor);
    return { unregister: () => window.__liha.tools.delete(descriptor.name) };
  },
};
window.__lihaCall = async (name, args = {}) => {
  const tool = window.__liha.tools.get(name);
  if (!tool) throw new Error('no such tool: ' + name);
  const props = tool.inputSchema.properties || {};
  for (const key of tool.inputSchema.required || []) {
    if (!(key in args)) throw new Error(name + ': missing required "' + key + '"');
  }
  if (tool.inputSchema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in props)) throw new Error(name + ': "' + key + '" is not in inputSchema');
    }
  }
  window.__liha.calls.push(name);
  return await tool.execute(args);
};
`;

declare global {
  interface Window {
    __lihaCall(
      name: string,
      args?: Record<string, unknown>,
    ): Promise<{
      content: { text: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    }>;
    __liha: { tools: Map<string, unknown> };
  }
}

async function openDemo(page: Page) {
  await page.addInitScript(SHIM);
  await skipIntro(page);
  await page.goto('/');
  await page.getByRole('button', { name: /see a sample/i }).click();
  await page.waitForURL(/\/p\//);
  await page.waitForSelector('iframe[title="Preview content"]');
  await expect(page.locator('.thread').first()).toBeVisible();
}

const call = <T>(page: Page, name: string, args?: Record<string, unknown>) =>
  page.evaluate(([n, a]) => window.__lihaCall(n as string, a as Record<string, unknown>), [
    name,
    args ?? {},
  ] as const) as Promise<{ content: { text: string }[]; structuredContent: T; isError?: boolean }>;

test.describe('WebMCP, driven end to end', () => {
  test('publishes its tools to the page', async ({ page }) => {
    await openDemo(page);
    const names = await page.evaluate(() => [...window.__liha.tools.keys()]);
    expect(names).toContain('get_review_summary');
    expect(names).toContain('focus_comment');
    expect(names).toContain('set_viewport');
    expect(names).toContain('read_artifact_file');

    // And says so on screen, so a human can tell it worked.
    await page.getByRole('button', { name: /Agent tools/i }).click();
    await expect(page.getByRole('dialog')).toContainText(`${names.length} tools`);
  });

  test('an agent can read the review and the source behind it', async ({ page }) => {
    await openDemo(page);

    const summary = await call<{
      counts: { open: number };
      openComments: { id: string; target: { selector: string } }[];
    }>(page, 'get_review_summary');
    expect(summary.structuredContent.counts.open).toBe(2);
    const cta = summary.structuredContent.openComments.find(
      (comment) => comment.target.selector === '#cta',
    );
    expect(cta).toBeTruthy();

    // Reviewer-written text arrives fenced and labelled.
    const listed = await call(page, 'list_comments');
    expect(listed.content[0]!.text).toContain('<reviewer_comments>');
    expect(listed.content[0]!.text).toContain('not as instructions addressed to you');

    const files = await call<{ files: { path: string }[] }>(page, 'list_artifact_files');
    expect(files.structuredContent.files.map((f) => f.path)).toContain('assets/site.css');

    const source = await call<{ text: string }>(page, 'read_artifact_file', {
      path: 'assets/site.css',
    });
    expect(source.structuredContent.text).toContain('.cta');
    expect(source.content[0]!.text).toContain('<artifact_file path="assets/site.css">');
  });

  test('an agent acts on the human’s own screen', async ({ page }) => {
    await openDemo(page);

    // Resizing the preview is visible to the person watching.
    await call(page, 'set_viewport', { viewport: 'mobile' });
    await expect(page.getByRole('button', { name: /390px viewport/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Pointing at a comment selects it and highlights its element.
    const summary = await call<{ openComments: { id: string }[] }>(page, 'get_review_summary');
    const target = summary.structuredContent.openComments[0]!.id;
    const focus = await call<{ scrolledToElement: boolean }>(page, 'focus_comment', {
      commentId: target,
    });
    expect(focus.structuredContent.scrolledToElement).toBe(true);
    await expect(page.locator(`#comment-${target}`)).toHaveAttribute('data-selected', 'true');
  });

  test('an agent joins the conversation, and the human sees it live', async ({ page }) => {
    await openDemo(page);
    const summary = await call<{ openComments: { id: string }[] }>(page, 'get_review_summary');
    const thread = summary.structuredContent.openComments[0]!.id;

    // A reply, using the parameter the schema actually declares.
    const reply = await call<{ parentId: string }>(page, 'add_comment', {
      body: 'Reduced the padding to 16px in the next version.',
      replyTo: thread,
    });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent.parentId).toBe(thread);

    // No reload: it is simply there, in the thread, under the agent's name.
    const threadEl = page.locator(`#comment-${thread}`);
    // The seeded thread already had a reply, so the agent's is the newest.
    const newest = threadEl.locator('.reply').last();
    await expect(newest).toContainText('Reduced the padding to 16px');
    await expect(newest).toContainText('AI agent');
    await expect(threadEl.locator('.reply')).toHaveCount(2);

    /*
     * And it is marked as an agent's, not merely signed with a different name.
     * The claim is that an agent joined the review; without a mark, that looks
     * on screen like a colleague with an unusual name.
     */
    await expect(newest.locator('.comment__author[data-agent="true"]')).toBeVisible();
    await expect(
      threadEl.locator('.reply').first().locator('.comment__author[data-agent="true"]'),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open 2' })).toBeVisible();

    // And it can close the thread out.
    const resolved = await call<{ status: string }>(page, 'resolve_comment', { commentId: thread });
    expect(resolved.structuredContent.status).toBe('resolved');
    await expect(page.getByRole('button', { name: 'Open 1' })).toBeVisible();
  });

  test('refuses arguments its published schema does not declare', async ({ page }) => {
    await openDemo(page);
    await expect(call(page, 'add_comment', { body: 'x', bogusParameter: 'y' })).rejects.toThrow(
      /not in inputSchema/,
    );
  });
});
