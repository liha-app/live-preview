import { expect, test, type Page } from '@playwright/test';
import { skipIntro } from './home.js';
import { asNewClient } from './clients.js';

const API = 'http://localhost:8787';

const SITE = {
  'index.html':
    '<!doctype html><html><head><meta charset="utf-8"><title>Acme</title></head><body>' +
    '<section class="hero"><h1>Ship faster</h1>' +
    '<button class="cta" id="cta">Get started now</button></section>' +
    '<footer id="foot"><p>Contact us</p></footer></body></html>',
};

interface Created {
  preview: { slug: string; shareUrl: string };
  ownerToken: string;
}

async function createPreview(): Promise<Created> {
  const form = new FormData();
  form.append('title', 'Acme');
  form.append('files', new File([SITE['index.html']], 'f'));
  form.append('paths', JSON.stringify(['index.html']));
  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

async function openAsOwner(page: Page, created: Created) {
  await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
  await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
}

async function commentOn(page: Page, selector: string, body: string, name = 'Sam') {
  await page.frameLocator('iframe[title="Preview content"]').locator(selector).click();
  const composer = page.locator('.inline-composer');
  await expect(composer).toBeVisible();
  await page.keyboard.type(body);
  const nameField = composer.getByPlaceholder('Your name');
  if (await nameField.isVisible()) await nameField.fill(name);
  await composer.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(composer).toBeHidden();
}

test.describe('writing comments', () => {
  test('opens focused on mouse-down, so typing needs no extra click', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    // The composer is mounted by the pointerdown, before the button is released.
    await page.frameLocator('iframe[title="Preview content"]').locator('#cta').hover();
    await page.mouse.down();
    await expect(page.locator('.inline-composer textarea')).toBeVisible();
    await page.mouse.up();

    // Once it is on screen it holds the caret: nothing is dropped from here on.
    await expect(page.locator('.inline-composer textarea')).toBeFocused();
    await page.keyboard.type('Too big.');
    await expect(page.locator('.inline-composer textarea')).toHaveValue('Too big.');
  });

  test('shows exactly one composer at a time', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await expect(page.locator('.sidebar .composer__input')).toBeVisible();
    await page.frameLocator('iframe[title="Preview content"]').locator('#cta').click();

    // The floating composer takes over; the sidebar one steps aside.
    await expect(page.locator('.inline-composer textarea')).toBeVisible();
    await expect(page.locator('.sidebar .composer__input')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.sidebar .composer__input')).toBeVisible();
  });

  test('submits with the keyboard alone, from click to posted', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await page.frameLocator('iframe[title="Preview content"]').locator('#cta').click();
    await expect(page.locator('.inline-composer textarea')).toBeFocused();
    await page.keyboard.type('Too big.');
    await page.locator('.inline-composer').getByPlaceholder('Your name').fill('Sam');
    await page.locator('.inline-composer textarea').focus();

    const submit = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await page.keyboard.press(submit);

    await expect(page.locator('.inline-composer')).toBeHidden();
    await expect(page.locator('.thread').first()).toContainText('Too big.');
  });

  test('Escape abandons the draft and clears the target', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await page.frameLocator('iframe[title="Preview content"]').locator('#cta').click();
    await expect(page.locator('.inline-composer')).toBeVisible();
    await page.keyboard.type('never mind');
    await page.keyboard.press('Escape');

    await expect(page.locator('.inline-composer')).toBeHidden();
    await expect(page.locator('.annotation-pin')).toHaveCount(0);
    await expect(page.locator('.thread')).toHaveCount(0);
  });

  test('keeps an unsent draft across a reload', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await page.locator('.sidebar textarea').fill('half-written thought');
    await page.reload();
    await expect(page.locator('.sidebar textarea')).toHaveValue('half-written thought');
  });

  test('remembers the reviewer name and stops asking for it', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await commentOn(page, '#cta', 'First note.', 'Sam');
    await page.frameLocator('iframe[title="Preview content"]').locator('#foot').click();

    const composer = page.locator('.inline-composer');
    await expect(composer.getByPlaceholder('Your name')).toBeHidden();
    await expect(composer.locator('.composer__whoami')).toHaveText('Sam');
  });

  test('holds a conversation in a thread', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);
    await commentOn(page, '#cta', 'Make this smaller.', 'Sam');

    const thread = page.locator('.thread').first();
    await thread.getByRole('button', { name: /Reply/ }).click();
    await page.keyboard.type('Agreed, 14px.');
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();

    await expect(thread.locator('.reply')).toHaveCount(1);
    await expect(thread.locator('.reply')).toContainText('Agreed, 14px.');
    // A reply does not create a second thread.
    await expect(page.locator('.thread')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open 1' })).toBeVisible();
  });

  test('resolving a thread takes its replies with it', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);
    await commentOn(page, '#cta', 'Make this smaller.', 'Sam');

    const thread = page.locator('.thread').first();
    await thread.getByRole('button', { name: /Reply/ }).click();
    await page.keyboard.type('On it.');
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(thread.locator('.reply')).toHaveCount(1);

    await thread.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.locator('.thread')).toHaveCount(0);

    await page.getByRole('button', { name: 'Resolved 1' }).click();
    await expect(page.locator('.thread .reply')).toHaveCount(1);
  });

  test('navigates comments with J and K, and resolves with E', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);
    await commentOn(page, '#cta', 'First.', 'Sam');
    await commentOn(page, '#foot', 'Second.');

    // Posting selects the new comment; Escape clears that so J starts at the top.
    await expect(page.locator('.thread[data-selected="true"]')).toContainText('Second.');
    await page.keyboard.press('Escape');
    await expect(page.locator('.thread[data-selected="true"]')).toHaveCount(0);

    await page.keyboard.press('j');
    await expect(page.locator('.thread[data-selected="true"]')).toContainText('First.');
    await page.keyboard.press('j');
    await expect(page.locator('.thread[data-selected="true"]')).toContainText('Second.');
    await page.keyboard.press('k');
    await expect(page.locator('.thread[data-selected="true"]')).toContainText('First.');

    // Selecting a comment deep-links to it.
    expect(page.url()).toContain('comment=cm_');

    await page.keyboard.press('e');
    await expect(page.getByRole('button', { name: 'Resolved 1' })).toBeVisible();
  });

  test('switches tools from the keyboard', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await page.keyboard.press('r');
    await expect(page.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('d');
    await expect(page.getByRole('button', { name: 'Draw' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Inspect' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('opens a shared comment link directly', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);
    await commentOn(page, '#cta', 'Look here.', 'Sam');

    const id = (await page.locator('.thread').first().getAttribute('id'))!.replace('comment-', '');
    await page.goto(`/p/${created.preview.slug}?comment=${id}`);
    await expect(page.locator(`#comment-${id}`)).toHaveAttribute('data-selected', 'true');
  });

  test('a single letter typed into the composer is not a shortcut', async ({ page }) => {
    const created = await createPreview();
    await openAsOwner(page, created);

    await page.locator('.sidebar textarea').fill('');
    await page.locator('.sidebar textarea').focus();
    await page.keyboard.type('draw a red box');

    await expect(page.locator('.sidebar textarea')).toHaveValue('draw a red box');
    await expect(page.getByRole('button', { name: 'Inspect' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('theme', () => {
  test('follows the system preference by default', async ({ browser }) => {
    const created = await createPreview();
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(`/p/${created.preview.slug}`);
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe(scheme === 'dark' ? 'rgb(16, 16, 18)' : 'rgb(255, 255, 255)');
      await context.close();
    }
  });

  test('an explicit choice overrides the system and survives a reload', async ({ browser }) => {
    const created = await createPreview();
    // A dark OS: the user still wants light.
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(`/p/${created.preview.slug}`);

    const toggle = page.getByRole('button', { name: /Colour theme/ });
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );

    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await toggle.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    await context.close();
  });

  test('T cycles the theme, even before the preview has loaded', async ({ page }) => {
    const created = await createPreview();
    await page.goto(`/p/${created.preview.slug}`);
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    await page.keyboard.press('t');
    await page.keyboard.press('t');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('sets color-scheme so native controls match', async ({ browser }) => {
    const created = await createPreview();
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(`/p/${created.preview.slug}`);
    // The cycle runs system -> light -> dark, so two clicks from the default.
    await page.getByRole('button', { name: /Colour theme/ }).click();
    await page.getByRole('button', { name: /Colour theme/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
    await context.close();
  });
});

test.describe('first run', () => {
  test('one click puts a newcomer inside a real review', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');

    await page.getByRole('button', { name: /see a sample/i }).click();
    await page.waitForURL(/\/p\//);

    // A real artifact, not a mockup of one.
    const content = page.frameLocator('iframe[title="Preview content"]');
    await expect(content.locator('h1')).toContainText('Ship faster');
    await expect(content.locator('#cta')).toBeVisible();

    // Seeded feedback is already there, anchored and threaded.
    await expect(page.getByRole('button', { name: 'Open 2' })).toBeVisible();
    const first = page.locator('.thread').first();
    await expect(first.locator('.comment__selector')).toHaveText('#cta');
    await expect(first.locator('.reply')).toHaveCount(1);
    await expect(page.locator('.annotation-pin')).toHaveCount(1);
    await expect(page.locator('.annotation-svg rect')).toBeVisible();

    // And the visitor owns it, so they can finish the loop themselves.
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    await first.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open 1' })).toBeVisible();

    // It looks exactly like a preview they made, so it has to say it goes away.
    await expect(page.locator('.topbar__expiry')).toHaveText(/Expires in 23h/);
  });

  test('the sample markers actually sit on what they describe', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');
    await page.getByRole('button', { name: /see a sample/i }).click();
    await page.waitForURL(/\/p\//);
    await page.frameLocator('iframe[title="Preview content"]').locator('#cta').waitFor();

    /*
     * The pin should be within the button's neighbourhood, and the box should
     * overlap the feature section — a marker that misses its subject is worse
     * than no marker at all.
     *
     * Polled, because `#cta` exists as soon as the iframe parses while the
     * markers are placed from a measurement of the iframe that lands a frame or
     * two later. Reading once raced that on a loaded machine and put the pin
     * 225px from a button it is drawn on. Polling still fails if a marker never
     * arrives at its subject; it only stops the test insisting on the answer
     * before the app has worked it out.
     */
    const content = page.frameLocator('iframe[title="Preview content"]');

    await expect
      .poll(async () => {
        const target = await content.locator('#cta').boundingBox();
        const pin = await page.locator('.annotation-pin').boundingBox();
        if (!target || !pin) return null;
        return {
          x: Math.abs(pin.x - target.x) < 120,
          y: Math.abs(pin.y - (target.y + target.height)) < 120,
        };
      })
      .toEqual({ x: true, y: true });

    await expect
      .poll(async () => {
        const features = await content.locator('#features').boundingBox();
        const box = await page.locator('.annotation-svg rect').boundingBox();
        if (!features || !box) return null;
        // Rectangles overlap vertically.
        return box.y < features.y + features.height && box.y + box.height > features.y;
      })
      .toBe(true);
  });
});

test.describe('when the API is unreachable', () => {
  test('says the server is down, not that the preview is missing', async ({ page }) => {
    const created = await createPreview();
    // Everything the app sends to the API fails, as if the server were down.
    await page.route('**/api/**', (route) => route.abort('failed'));

    await page.goto(`/p/${created.preview.slug}`);

    await expect(page.getByText('Cannot reach the server')).toBeVisible();
    await expect(page.getByText('Preview not found')).toHaveCount(0);

    // And it recovers once the API comes back.
    await page.unroute('**/api/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('iframe[title="Preview content"]')).toBeVisible();
  });
});
