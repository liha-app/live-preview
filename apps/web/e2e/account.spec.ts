import { expect, test, type Page } from '@playwright/test';
import { asNewClient } from './clients.js';
import { skipIntro } from './home.js';

const API = 'http://localhost:8787';

const SITE = '<!doctype html><h1>Ship faster</h1><button id="cta">Get started</button>';

/*
 * Everything works without an account. One is minted the first time a browser
 * *acts*, anonymously, with nothing asked for — so this page has something in
 * it without anybody having signed up.
 */
/** Publishes something, which is the moment the offer is made. */
async function publishAUrl(page: Page) {
  await page.getByRole('button', { name: 'Review a URL' }).click();
  await page
    .getByRole('textbox', { name: /review a url that is already deployed/i })
    .fill('https://example.com');
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('button', { name: 'Create preview' }).click();
}

test.describe('what this browser is involved in', () => {
  /*
   * Signing in lives on that page, so the way to it cannot be hidden until you
   * already have something — that is exactly backwards, and it is how this
   * shipped the first time.
   */
  test('is reachable from the landing page before there is anything in it', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');

    await page.getByRole('link', { name: 'Your previews' }).click();
    await page.waitForURL(/\/me$/);

    await expect(page.getByRole('heading', { name: 'Previews' })).toBeVisible();
    await expect(page.getByText('Nothing yet. Publish something')).toBeVisible();
    // And the way in is right there, with nothing behind it yet.
    await expect(page.getByRole('link', { name: /sign in with google/i })).toBeVisible();
  });

  /*
   * A control that vanishes with nothing where it was reads as a bug rather
   * than as success, and signing in is exactly when it vanishes.
   */
  test('says so where the button was, once signed in', async ({ page }) => {
    await skipIntro(page);
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        json: {
          account: { id: 'ac_x', signedIn: true, email: 'sam@example.com', displayName: 'Sam' },
          googleAvailable: true,
          retentionDays: { anonymous: 7, signedIn: 30 },
        },
      });
    });

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'sam@example.com' })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in with google/i })).toHaveCount(0);
  });

  /*
   * The offer is made once somebody has published something — the first moment
   * there is anything to keep — and never again once they say so. Which is why
   * signing in also has a permanent home: a dismissed prompt must not be the
   * only door.
   */
  test('offers an account after publishing, and stops asking when told to', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');

    await publishAUrl(page);

    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Keep this on an account?')).toBeVisible();
    await modal.getByRole('button', { name: /don.t ask again/i }).click();
    await expect(modal).toHaveCount(0);

    // Publishing again is the same trigger, and it must stay quiet this time.
    // Reloading and looking would prove nothing: nothing fires on arrival.
    await page.goto('/');
    await publishAUrl(page);
    await expect(page.getByRole('heading', { name: 'Preview created' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    /*
     * Still reachable by hand, which is the other half of the promise — and it
     * goes to Google, because that is what it says. A button whose label is an
     * action and whose behaviour is a dialog is a lie about what it does.
     */
    await page.goto('/');
    const signIn = page.getByRole('link', { name: /sign in with google/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('href', /\/api\/auth\/google\/start\?return=/);

    // Google's mark, in Google's colours, on Google's surface — the landing
    // page restyles everything on it, and this is the one thing it may not.
    await expect(signIn.locator('svg path')).toHaveCount(4);
    expect(await signIn.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
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

    // And the landing page still points at it.
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
