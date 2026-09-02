import { expect, test } from '@playwright/test';
import { asNewClient } from './clients.js';
import { skipIntro, skipAccountPrompt } from './home.js';

/* The offer to sign in is a real dialog, and it lands in front of the next
   click. These suites are about something else. */
test.beforeEach(({ page }) => skipAccountPrompt(page));

const API = 'http://localhost:8787';

/**
 * An image preview and an HTML preview reach the content origin by different
 * routes — an `<img>` and an iframe — and a deployment can be configured so one
 * works and the other is blank. That is not hypothetical: a live instance
 * showed an uploaded screenshot's filename and nothing under it, because its
 * Content-Security-Policy named the content host for frames but not for images.
 *
 * The dev server sends no CSP at all, so this suite cannot catch that by
 * itself — scripts/verify-deployment.mjs checks the deployed policy. What is
 * checked here is the half a CSP cannot explain: that the stage points at the
 * artifact and the artifact arrives.
 */

// A 64x64 PNG. Small enough to inline, real enough to decode.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3QMQEAAAjDMOZf9BAcRxMFfXtnAABgKQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgFwPzAAGH0nBLAAAAAElFTkSuQmCC',
  'base64',
);

async function createImagePreview() {
  const form = new FormData();
  form.append('title', 'A screenshot');
  form.append('files', new File([new Uint8Array(PNG)], 'shot.png', { type: 'image/png' }));
  form.append('paths', JSON.stringify(['shot.png']));

  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    preview: { slug: string; type: string; contentUrl: string };
  };
}

test.describe('an image artifact', () => {
  test('is decoded and shown, not just named', async ({ page }) => {
    const created = await createImagePreview();
    expect(created.preview.type).toBe('image');

    await skipIntro(page);
    await page.goto(`/p/${created.preview.slug}`);

    const image = page.locator('.stage__frame img');
    await expect(image).toBeVisible();

    // Visible is not enough: a blocked or missing image is still "visible" at
    // whatever size its box happens to be. Decoding is the real question.
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);

    // And it is pointed at the isolated content origin, not the app.
    const source = await image.getAttribute('src');
    expect(source).toBe(created.preview.contentUrl);
    expect(new URL(source!).origin).not.toBe(new URL(page.url()).origin);
  });

  test('can be commented on where the reviewer clicked', async ({ page }) => {
    const created = await createImagePreview();

    await skipIntro(page);
    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.locator('.stage__frame img')).toBeVisible();

    await page.locator('.stage__frame').click({ position: { x: 30, y: 30 } });
    await page
      .getByPlaceholder(/comment/i)
      .first()
      .fill('This corner is too dark.');
    await page.getByRole('button', { name: /^Comment$/ }).click();

    await expect(page.locator('.thread')).toHaveCount(1);
    await expect(page.locator('.thread').first()).toContainText('too dark');
  });
});

test.describe('the drawings on the landing page', () => {
  test('show this deployment’s own host, not the mock’s', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'How it works' }).click();

    const host = new URL(page.url()).host;
    await expect(page.locator('.ob-url')).toHaveText(`${host}/p/8fa2c1`);
  });
});
