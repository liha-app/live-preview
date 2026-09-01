import AxeBuilder from '@axe-core/playwright';
import { asNewClient } from './clients.js';
import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:8787';

interface Created {
  preview: { slug: string };
  ownerToken: string;
}

async function createPreview(): Promise<Created> {
  const form = new FormData();
  form.append('title', 'Acme');
  form.append(
    'files',
    new File(
      ['<!doctype html><html><body><button id="cta">Get started</button></body></html>'],
      'f',
    ),
  );
  form.append('paths', JSON.stringify(['index.html']));
  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  return (await response.json()) as Created;
}

/**
 * Scans the app's own DOM only. The preview iframe holds untrusted third-party
 * markup whose accessibility is the artifact author's business, not ours.
 */
function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('iframe[title="Preview content"]')
    .analyze();
}

test.describe('accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`home page has no violations in ${scheme} mode`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Liha Live Preview' })).toBeVisible();
      expect((await scan(page)).violations).toEqual([]);
      await context.close();
    });

    test(`review page has no violations in ${scheme} mode`, async ({ browser }) => {
      const created = await createPreview();
      await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Sam', body: 'Make this smaller.' }),
      });
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
      await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
      expect((await scan(page)).violations).toEqual([]);
      await context.close();
    });
  }

  test('dialogs have no violations', async ({ page }) => {
    const created = await createPreview();
    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

    for (const open of ['Share', 'Update'] as const) {
      await page.getByRole('button', { name: open }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await scan(page)).violations).toEqual([]);
      await page.keyboard.press('Escape');
    }

    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test('a dialog keeps the keyboard inside it and gives focus back', async ({ page }) => {
    const created = await createPreview();
    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
    const opener = page.getByRole('button', { name: 'Share' });
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Tab all the way round; focus must never leave the dialog.
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((element) => element.contains(document.activeElement));
      expect(inside, `focus escaped after ${step + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('the password gate has no violations', async ({ page }) => {
    const form = new FormData();
    form.append('password', 'open-sesame');
    form.append('files', new File(['<html><body>x</body></html>'], 'f'));
    form.append('paths', JSON.stringify(['index.html']));
    const created = (await fetch(`${API}/api/previews`, {
      method: 'POST',
      headers: asNewClient(),
      body: form,
    }).then((r) => r.json())) as Created;

    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });
});
