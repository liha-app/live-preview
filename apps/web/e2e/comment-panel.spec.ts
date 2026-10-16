import { expect, test, type Page } from '@playwright/test';
import { skipAccountPrompt, skipIntro } from './home.js';
import { asNewClient } from './clients.js';

const API = 'http://localhost:8787';
const SITE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Panel fixture</title></head>' +
  '<body><button id="cta">Review this button</button><div style="height:2000px">Long page</div></body></html>';

async function openFixture(page: Page, comments = 0) {
  const form = new FormData();
  form.append('title', 'Comment panel fixture');
  form.append('files', new File([SITE], 'index.html'));
  form.append('paths', JSON.stringify(['index.html']));
  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { preview: { slug: string }; ownerToken: string };
  for (let i = 0; i < comments; i++) {
    const added = await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { ...asNewClient(), 'content-type': 'application/json' },
      body: JSON.stringify({ body: `Review thread ${i + 1}`, authorName: 'Reviewer' }),
    });
    expect(added.status).toBe(201);
  }
  await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
  await expect(page.getByRole('button', { name: 'Hide comments', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar .spinner')).toHaveCount(0);
  return created.preview.slug;
}

test.beforeEach(async ({ page }) => {
  await skipIntro(page);
  await skipAccountPrompt(page);
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`comment panel at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('renders one shortcut badge, toggles accessibly and returns space to the preview', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await openFixture(page);
      const panel = page.getByRole('complementary', { name: 'Review comments' });
      await expect(panel.locator('.empty .faint')).toHaveText(
        'Click anywhere on the preview to leave one, or press C.',
      );
      await expect(panel.locator('.empty kbd')).toHaveCount(1);
      const before = (await page.locator('.stage').boundingBox())!;
      await page.screenshot({ path: test.info().outputPath('panel-open.png') });
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      const toggle = page.getByRole('button', { name: 'Show comments', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveAttribute('aria-controls', 'review-comments');
      await expect(panel).toBeHidden();
      const after = (await page.locator('.stage').boundingBox())!;
      expect(viewport.width > 900 ? after.width : after.height).toBeGreaterThan(
        viewport.width > 900 ? before.width : before.height,
      );
      await page.screenshot({ path: test.info().outputPath('panel-closed.png') });
      await toggle.click();
      await expect(panel).toBeVisible();
      await page.getByRole('button', { name: 'Hide comments', exact: true }).dblclick();
      await expect(
        page.getByRole('button', { name: 'Hide comments', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
    });

    test('keeps the icon toggle named, touchable and keyboard operable in both languages', async ({
      page,
    }) => {
      await openFixture(page);
      const toggle = page.locator('.topbar__comments');
      const panel = page.locator('#review-comments');
      for (const [locale, hide, show] of [
        ['en', 'Hide comments', 'Show comments'],
        ['ja', 'コメントを閉じる', 'コメントを表示'],
      ] as const) {
        if (locale === 'ja') await page.getByRole('button', { name: /Language/ }).click();
        await expect(toggle).toHaveAccessibleName(hide);
        await expect(toggle).toHaveAttribute('title', hide);
        await expect(toggle).toHaveAttribute('aria-controls', 'review-comments');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveText('');
        await expect(toggle.locator('svg')).toHaveClass(/lucide-panel-right-close/);
        await expect(toggle.locator('svg')).toHaveAttribute('aria-hidden', 'true');
        const target = (await toggle.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.x).toBeGreaterThanOrEqual(0);
        expect(target.x + target.width).toBeLessThanOrEqual(viewport.width);

        await toggle.focus();
        await page.keyboard.press('Tab');
        await expect(toggle).not.toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(toggle).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAccessibleName(show);
        await expect(toggle).toHaveAttribute('title', show);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle.locator('svg')).toHaveClass(/lucide-panel-right-open/);
        await expect(panel).toBeHidden();

        await page.keyboard.press('Space');
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAccessibleName(hide);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle.locator('svg')).toHaveClass(/lucide-panel-right-close/);
        await expect(panel).toBeVisible();
      }
    });

    test('preserves draft, caret, replies, selected thread and list scroll without posting', async ({
      page,
    }) => {
      await openFixture(page, 16);
      let posted = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('/comments')) posted++;
      });
      const draft = page.locator('.sidebar > .composer textarea');
      await draft.fill('Unsent note about this version');
      await draft.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(2, 8));
      const first = page.locator('.thread').first();
      await first.locator('.thread__root').click();
      await first.getByRole('button', { name: 'Reply', exact: true }).click();
      const reply = first.locator('.thread__composer textarea');
      await reply.fill('Unsent reply');
      const selectedId = await first.getAttribute('id');
      const list = page.locator('.comment-list');
      await list.evaluate((element) => {
        element.scrollTop = 150;
      });
      const scroll = await list.evaluate((element) => element.scrollTop);
      expect(scroll).toBeGreaterThan(0);
      const url = page.url();
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('e');
      await page.getByRole('button', { name: 'Show comments', exact: true }).click();
      await expect(draft).toHaveValue('Unsent note about this version');
      expect(
        await draft.evaluate((element) => [
          (element as HTMLTextAreaElement).selectionStart,
          (element as HTMLTextAreaElement).selectionEnd,
        ]),
      ).toEqual([2, 8]);
      await expect(reply).toHaveValue('Unsent reply');
      await expect(page.locator('.thread[data-selected="true"]')).toHaveAttribute(
        'id',
        selectedId!,
      );
      expect(await list.evaluate((element) => element.scrollTop)).toBe(scroll);
      expect(page.url()).toBe(url);
      expect(posted).toBe(0);
    });

    test('reopens for keyboard and iframe targets and preserves the inline draft', async ({
      page,
    }) => {
      await openFixture(page);
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.keyboard.press('c');
      await expect(page.locator('.sidebar textarea')).toBeFocused();
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.frameLocator('iframe[title="Preview content"]').locator('#cta').click();
      await expect(page.getByRole('button', { name: 'Hide comments', exact: true })).toBeVisible();
      const input = page.locator('.inline-composer textarea');
      await expect(input).toBeFocused();
      await input.fill('Inline draft remains attached');
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await expect(input).toBeHidden();
      await page
        .frameLocator('iframe[title="Preview content"]')
        .locator('html')
        .evaluate(() => window.scrollTo(0, 250));
      await page.setViewportSize({ width: viewport.width, height: viewport.height + 40 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.getByRole('button', { name: 'Show comments', exact: true })).toBeVisible();
      await expect(input).toBeHidden();
      await page.getByRole('button', { name: 'Show comments', exact: true }).click();
      await expect(input).toHaveValue('Inline draft remains attached');
      await expect(page.locator('.inline-composer .composer__target')).toContainText('#cta');
      await expect(page.locator('.annotation-pin')).toHaveCount(1);
    });

    test('focuses the inline draft before a retained reply and keeps immediate typing', async ({
      page,
    }) => {
      await openFixture(page, 1);
      const thread = page.locator('.thread').first();
      await thread.getByRole('button', { name: 'Reply', exact: true }).click();
      const reply = thread.locator('.thread__composer textarea');
      await reply.fill('Reply kept separate');
      await page.frameLocator('iframe[title="Preview content"]').locator('#cta').click();
      const inline = page.locator('.inline-composer textarea');
      await inline.fill('Inline ');
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.keyboard.type('cfast');
      await expect(inline).toHaveValue('Inline fast');
      await expect(inline).toBeFocused();
      await expect(reply).toHaveValue('Reply kept separate');
    });

    test('keeps the drawing surface stable until a rectangle is finished', async ({ page }) => {
      await openFixture(page);
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.keyboard.press('r');
      const layer = page.locator('.annotation-layer--drawing');
      await expect(layer).toBeVisible();
      const before = (await layer.boundingBox())!;
      await page.mouse.move(before.x + 30, before.y + 50);
      await page.mouse.down();
      await page.mouse.move(before.x + 100, before.y + 130, { steps: 5 });
      await expect(page.getByRole('button', { name: 'Show comments', exact: true })).toBeVisible();
      expect(await layer.boundingBox()).toEqual(before);
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Hide comments', exact: true })).toBeVisible();
      await expect(page.locator('.inline-composer textarea')).toBeFocused();
    });

    test('remeasures the composer when a pending post completes while hidden', async ({ page }) => {
      await openFixture(page);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/previews/*/comments', async (route) => {
        if (route.request().method() === 'POST') await pending;
        await route.continue();
      });
      const draft = page.locator('.sidebar > .composer textarea');
      await draft.fill('Posting before closing');
      await page.locator('.sidebar').getByRole('button', { name: 'Comment', exact: true }).click();
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      release();
      await expect(draft).toHaveValue('');
      await page.getByRole('button', { name: 'Show comments', exact: true }).click();
      expect((await draft.boundingBox())!.height).toBeGreaterThan(40);
      await expect(page.locator('.thread')).toHaveCount(1);
    });

    test('retains the selected deep link and saved version draft when returning with Back', async ({
      page,
    }) => {
      const slug = await openFixture(page, 1);
      await page.locator('.thread__root').click();
      await page.locator('.sidebar > .composer textarea').fill('Draft before navigating away');
      const url = page.url();
      await page.getByRole('button', { name: 'Hide comments', exact: true }).click();
      await page.goto('/');
      await page.goBack();
      await expect(page).toHaveURL(url);
      await expect(page.locator('.sidebar textarea')).toHaveValue('Draft before navigating away');
      await expect(page.locator('.thread[data-selected="true"]')).toHaveCount(1);
      expect(page.url()).toContain(`/p/${slug}`);
    });
  });
}
