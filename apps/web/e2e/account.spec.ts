import { expect, test } from '@playwright/test';
import { asNewClient } from './clients.js';
import { skipIntro } from './home.js';

const API = 'http://localhost:8787';

const SITE = '<!doctype html><h1>Ship faster</h1><button id="cta">Get started</button>';

/*
 * Everything works without an account. One is minted the first time a browser
 * *acts*, anonymously, with nothing asked for — so this page has something in
 * it without anybody having signed up.
 */
test.describe('what this browser is involved in', () => {
  test('is empty before doing anything, and has no door on the landing page', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'Previews' })).toBeVisible();
    await expect(page.getByText('Nothing yet. Publish something')).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Your previews' })).toHaveCount(0);
  });

  test('lists what I made and what happened on it', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');
    // Publishing through the app is the act that mints the account.
    await page.getByRole('button', { name: /see a sample/i }).click();
    await page.waitForURL(/\/p\//);
    const slug = new URL(page.url()).pathname.split('/').pop()!;

    // Somebody else comments on it.
    const response = await fetch(`${API}/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...asNewClient() },
      body: JSON.stringify({ authorName: 'Mika', body: 'The hero is too tall.' }),
    });
    expect(response.status).toBe(201);

    await page.goto('/me');
    const previews = page.locator('section', {
      has: page.getByRole('heading', { name: 'Previews' }),
    });
    await expect(previews.locator('.me__name')).toContainText('Northwind');
    await expect(previews.locator('.me__meta')).toContainText('yours');

    // Newest first, and the sample's own seeded feedback is in here too — it is
    // feedback on your preview that you did not write, which is what this is.
    const activity = page.locator('section', {
      has: page.getByRole('heading', { name: 'Activity' }),
    });
    await expect(activity.locator('.me__name').first()).toContainText('The hero is too tall.');
    await expect(activity.locator('.me__name')).toHaveCount(4);
    // Straight to the comment, not just to the preview.
    await expect(activity.locator('a').first()).toHaveAttribute('href', /comment=/);

    // And now the landing page has somewhere to go.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Your previews' })).toBeVisible();
  });

  /*
   * Retention counts from use rather than upload, so an owner can push it out
   * from the one place they are already worried about it.
   */
  test('the countdown is also how the owner keeps a preview', async ({ page }) => {
    const form = new FormData();
    form.append('title', 'Acme');
    form.append('files', new File([SITE], 'index.html'));
    form.append('paths', JSON.stringify(['index.html']));
    const created = (await (
      await fetch(`${API}/api/previews`, { method: 'POST', headers: asNewClient(), body: form })
    ).json()) as { preview: { slug: string }; ownerToken: string };

    await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

    const chip = page.locator('.topbar__expiry');
    await expect(chip).toHaveText(/6 days left/);
    await expect(chip).toBeEnabled();

    // Six days pass with nobody looking.
    await fetch(`${API}/api/previews/${created.preview.slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-liha-owner-token': created.ownerToken },
      body: JSON.stringify({ title: 'Acme' }),
    });
    await chip.click();
    await expect(chip).toHaveText(/6 days left/);
  });

  test('a reviewer sees the countdown but cannot change it', async ({ page }) => {
    const form = new FormData();
    form.append('title', 'Acme');
    form.append('files', new File([SITE], 'index.html'));
    form.append('paths', JSON.stringify(['index.html']));
    const created = (await (
      await fetch(`${API}/api/previews`, { method: 'POST', headers: asNewClient(), body: form })
    ).json()) as { preview: { slug: string } };

    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.locator('iframe[title="Preview content"]')).toBeVisible();
    await expect(page.locator('.topbar__expiry')).toBeDisabled();
  });
});
