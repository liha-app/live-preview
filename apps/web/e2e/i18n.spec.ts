import AxeBuilder from '@axe-core/playwright';
import { asNewClient } from './clients.js';
import { expect, test } from '@playwright/test';

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
    new File(['<!doctype html><html><body><button id="cta">Go</button></body></html>'], 'f'),
  );
  form.append('paths', JSON.stringify(['index.html']));
  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  return (await response.json()) as Created;
}

test.describe('localization', () => {
  test('follows the browser language', async ({ browser }) => {
    for (const [locale, heading] of [
      ['ja-JP', 'ビルド成果物'],
      ['en-US', 'Share a build'],
    ] as const) {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('.lede')).toContainText(heading);
      await expect(page.locator('html')).toHaveAttribute('lang', locale.slice(0, 2));
      await context.close();
    }
  });

  test('switches language and remembers the choice', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('.lede')).toContainText('Share a build');
    await page.getByRole('button', { name: /Language|言語/ }).click();

    await expect(page.locator('.lede')).toContainText('ビルド成果物');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    await page.reload();
    await expect(page.locator('.lede')).toContainText('ビルド成果物');
    await context.close();
  });

  test('translates the whole review screen', async ({ browser }) => {
    const created = await createPreview();
    await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorName: 'Sam', body: 'ボタンが大きすぎます。' }),
    });

    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);

    await expect(page.getByRole('button', { name: '更新' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^未解決/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '解決', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('このバージョン全体へのコメント…')).toBeVisible();
    await expect(page.getByRole('button', { name: '要素を選択' })).toBeVisible();

    // No English left behind on the main surface.
    const sidebar = await page.locator('.sidebar').innerText();
    expect(sidebar).not.toMatch(/\b(Resolve|Reply|Open|Resolved)\b/);
    await context.close();
  });

  test('translates dialogs and shortcuts', async ({ browser }) => {
    const created = await createPreview();
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);

    await page.getByRole('button', { name: '共有' }).click();
    await expect(page.getByRole('dialog', { name: '共有' })).toBeVisible();
    await expect(page.getByText('共有URL — バージョンが変わっても同じ')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'キーボードショートカット' }).click();
    await expect(page.getByRole('dialog', { name: 'キーボードショートカット' })).toBeVisible();
    await expect(page.getByText('コメントを書き始める')).toBeVisible();
  });

  test('is accessible in Japanese too', async ({ browser }) => {
    const created = await createPreview();
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
    await expect(page.getByRole('button', { name: '更新' })).toBeVisible();

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('iframe[title="Preview content"]')
      .analyze();
    expect(result.violations).toEqual([]);
    await context.close();
  });
});
