import { expect, test, type Page } from '@playwright/test';
import { asNewClient } from './clients.js';
import { COMMENT_POLL_MS } from '../src/lib/unseen.js';

const API = 'http://localhost:8787';

const SITE = {
  'index.html':
    '<!doctype html><html><head><meta charset="utf-8"><title>Acme</title>' +
    '<link rel="stylesheet" href="/assets/app.css"></head><body>' +
    '<section class="hero"><h1>Ship faster</h1>' +
    '<button class="cta" id="cta">Get started now</button></section></body></html>',
  'assets/app.css': '.cta{padding:22px 40px;font-size:22px}body{margin:0;padding:40px}',
};

interface Created {
  preview: { slug: string; shareUrl: string; contentUrl: string };
  ownerToken: string;
}

async function createPreview(files: Record<string, string>, title = 'Acme'): Promise<Created> {
  const form = new FormData();
  form.append('title', title);
  for (const content of Object.values(files)) {
    form.append('files', new File([content], 'file'));
  }
  form.append('paths', JSON.stringify(Object.keys(files)));
  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: asNewClient(),
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

/** Opens the preview as its owner, using the fragment-based owner link. */
async function openAsOwner(page: Page, created: Created) {
  await page.goto(`/p/${created.preview.slug}#owner=${created.ownerToken}`);
  await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
  // The token must be scrubbed from the URL once captured.
  expect(page.url()).not.toContain('owner=');
}

test.describe('the review loop in a real browser', () => {
  test('renders uploaded HTML inside a sandboxed, cross-origin iframe', async ({ page }) => {
    const created = await createPreview(SITE);
    await page.goto(`/p/${created.preview.slug}`);

    const frame = page.locator('iframe[title="Preview content"]');
    await expect(frame).toBeVisible();

    // No allow-same-origin: uploaded HTML gets an opaque origin.
    const sandbox = await frame.getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');

    // Served from a different origin than the app.
    const src = await frame.getAttribute('src');
    expect(new URL(src!).origin).not.toBe(new URL(page.url()).origin);

    const content = page.frameLocator('iframe[title="Preview content"]');
    await expect(content.locator('h1')).toHaveText('Ship faster');
    // Root-absolute assets resolve, so the stylesheet actually applied.
    await expect(content.locator('button.cta')).toHaveCSS('font-size', '22px');

    // Somebody's work is kept. Only samples count down.
    await expect(page.locator('.topbar__expiry')).toHaveCount(0);
  });

  test('clicking an element captures its DOM context into a comment', async ({ page }) => {
    const created = await createPreview(SITE);
    await openAsOwner(page, created);

    // The inspect tool is active by default; click the button in the preview.
    await page.frameLocator('iframe[title="Preview content"]').locator('button.cta').click();

    // A unique id beats a positional selector, so the bridge reports "#cta".
    // The composer floats next to what was clicked, already focused.
    const composer = page.locator('.inline-composer');
    await expect(composer).toBeVisible();
    await expect(composer.locator('.composer__target-text')).toContainText('#cta');
    await expect(composer.locator('textarea')).toBeFocused();

    await page.keyboard.type('Make this button smaller.');
    await composer.getByPlaceholder('Your name').fill('Sam');
    await composer.getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(composer).toBeHidden();
    const comment = page.locator('.thread').first();
    await expect(comment).toContainText('Make this button smaller.');
    await expect(comment).toContainText('Sam');
    await expect(comment.locator('.comment__selector')).toContainText('#cta');

    // The selector must be precise enough for an agent to act on.
    const listed = (await fetch(
      `${API}/api/previews/${created.preview.slug}/comments?status=open`,
    ).then((response) => response.json())) as {
      comments: { target: { element: { selector: string; textContent: string } } }[];
    };
    expect(listed.comments[0]!.target.element.selector).toBe('#cta');
    expect(listed.comments[0]!.target.element.textContent).toBe('Get started now');
  });

  test('draws a red-pen annotation and anchors it to the artifact', async ({ page }) => {
    const created = await createPreview(SITE);
    await openAsOwner(page, created);

    await page.getByRole('button', { name: 'Box' }).click();
    const stage = page.locator('.annotation-layer');
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 180, { steps: 8 });
    await page.mouse.up();

    const drawn = page.locator('.annotation-svg rect');
    await expect(drawn).toBeVisible();
    await expect(page.locator('.inline-composer .composer__target-text')).toContainText('rect at');

    // A shape with an unresolved CSS variable still has a bounding box, so
    // assert the stroke actually resolves to a colour.
    const stroke = await drawn.evaluate((element) => getComputedStyle(element).stroke);
    expect(stroke).toMatch(/^rgb/);

    await page.keyboard.type('This whole block is off.');
    await page
      .locator('.inline-composer')
      .getByRole('button', { name: 'Comment', exact: true })
      .click();
    await expect(page.locator('.thread')).toHaveCount(1);
    await expect(page.locator('.annotation-svg rect')).toBeVisible();
  });

  test('a new version keeps the share URL and marks old comments outdated', async ({ page }) => {
    const created = await createPreview(SITE);
    await openAsOwner(page, created);

    await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorName: 'Sam', body: 'Make this button smaller.' }),
    });

    const shareUrl = page.url();
    const form = new FormData();
    form.append('files', new File([SITE['index.html'].replace('Get started now', 'Start')], 'f'));
    form.append('files', new File(['.cta{padding:8px 14px;font-size:14px}'], 'f'));
    form.append('paths', JSON.stringify(['index.html', 'assets/app.css']));
    const published = await fetch(`${API}/api/previews/${created.preview.slug}/versions`, {
      method: 'POST',
      headers: { 'x-liha-owner-token': created.ownerToken },
      body: form,
    });
    expect(published.status).toBe(201);

    await page.reload();
    expect(page.url()).toBe(shareUrl);
    await expect(page.locator('select[aria-label="Version"]')).toContainText('v2');
    await expect(
      page.frameLocator('iframe[title="Preview content"]').locator('button.cta'),
    ).toHaveText('Start');

    await page.getByRole('button', { name: 'All 1' }).click();
    await expect(page.locator('.thread').first()).toContainText('outdated');
  });

  /*
   * "Did it get fixed?" is the question a reviewer actually has, and the answer
   * is one glance away — but only while getting there is one action. Through
   * the version dropdown it is three, which is enough not to bother.
   */
  test('flips between this version and the one before it in a click', async ({ page }) => {
    const created = await createPreview(SITE);

    const form = new FormData();
    form.append('files', new File([SITE['index.html'].replace('Get started now', 'Start')], 'f'));
    form.append('files', new File(['.cta{padding:8px 14px;font-size:14px}'], 'f'));
    form.append('paths', JSON.stringify(['index.html', 'assets/app.css']));
    await fetch(`${API}/api/previews/${created.preview.slug}/versions`, {
      method: 'POST',
      headers: { 'x-liha-owner-token': created.ownerToken },
      body: form,
    });

    await openAsOwner(page, created);
    const content = page.frameLocator('iframe[title="Preview content"]');
    await expect(content.locator('button.cta')).toHaveText('Start');

    // The button says where it takes you, so you know before you press it.
    const back = page.getByRole('button', { name: 'v1', exact: true });
    await expect(back).toBeVisible();
    await back.click();

    await expect(content.locator('button.cta')).toHaveText('Get started now');

    // And back again, without hunting for the current one in a list.
    const forward = page.getByRole('button', { name: 'v2', exact: true });
    await expect(forward).toBeVisible();
    await forward.click();
    await expect(content.locator('button.cta')).toHaveText('Start');
  });

  /*
   * Two marks in the same red, one a pixel thicker, are hard to tell apart at a
   * glance. Selecting one should make the difference obvious without being
   * looked for — and with nothing selected every mark is equally the subject,
   * so nothing should be faded then.
   */
  test('quietens the marks that are not selected', async ({ page }) => {
    // The sample already carries one of each kind: a pin on the button and a
    // rectangle round the feature row.
    const created = (await fetch(`${API}/api/previews/demo`, {
      method: 'POST',
      headers: asNewClient(),
    }).then((response) => response.json())) as Created;

    await openAsOwner(page, created);
    const marks = page.locator('.annotation-shape, .annotation-pin');
    await expect(marks).toHaveCount(2);

    const opacities = async () =>
      marks.evaluateAll((nodes) => nodes.map((n) => Number(getComputedStyle(n).opacity)));

    expect(await opacities()).toEqual([1, 1]);

    await page.locator('.thread [aria-expanded]').first().click();
    await expect
      .poll(async () => {
        const values = await opacities();
        return {
          full: values.filter((v) => v === 1).length,
          faded: values.filter((v) => v < 1).length,
        };
      })
      .toEqual({ full: 1, faded: 1 });

    // And selecting the other one moves the emphasis rather than adding to it.
    await page.locator('.thread [aria-expanded]').nth(1).click();
    await expect
      .poll(async () => {
        const values = await opacities();
        return {
          full: values.filter((v) => v === 1).length,
          faded: values.filter((v) => v < 1).length,
        };
      })
      .toEqual({ full: 1, faded: 1 });
  });

  test('resolves a comment as the owner', async ({ page }) => {
    const created = await createPreview(SITE);
    await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorName: 'Sam', body: 'Fix the spacing.' }),
    });
    await openAsOwner(page, created);

    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.locator('.thread')).toHaveCount(0);
    await page.getByRole('button', { name: 'Resolved 1' }).click();
    await expect(page.locator('.thread').first()).toContainText('Fix the spacing.');
  });

  test('asks for the password before showing anything', async ({ page }) => {
    const form = new FormData();
    form.append('title', 'Secret');
    form.append('password', 'open-sesame');
    form.append('files', new File(['<html><body><h1>Secret plans</h1></body></html>'], 'f'));
    form.append('paths', JSON.stringify(['index.html']));
    const created = (await fetch(`${API}/api/previews`, {
      method: 'POST',
      headers: asNewClient(),
      body: form,
    }).then((r) => r.json())) as Created;

    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.getByText('This preview is password protected.')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);

    await page.getByPlaceholder('Password').fill('wrong');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Incorrect password.')).toBeVisible();

    await page.getByPlaceholder('Password').fill('open-sesame');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.frameLocator('iframe[title="Preview content"]').locator('h1')).toHaveText(
      'Secret plans',
    );
  });

  test('uploaded script cannot reach the app origin', async ({ page }) => {
    const created = await createPreview({
      'index.html':
        '<!doctype html><html><body><p id="out">idle</p><script>' +
        'var r = []; try { r.push("storage:" + typeof localStorage.getItem("liha.owner.x")); }' +
        ' catch (e) { r.push("storage:blocked"); }' +
        ' try { r.push("parent:" + String(parent.location.href)); }' +
        ' catch (e) { r.push("parent:blocked"); }' +
        ' document.getElementById("out").textContent = r.join(" | ");' +
        '</script></body></html>',
    });
    await openAsOwner(page, created);

    const output = page.frameLocator('iframe[title="Preview content"]').locator('#out');
    await expect(output).not.toHaveText('idle');
    const text = (await output.textContent()) ?? '';
    // An opaque origin has no storage and no readable parent.
    expect(text).toContain('storage:blocked');
    expect(text).toContain('parent:blocked');
    expect(text).not.toContain('liha_ot_');
  });
});

/*
 * A share link is a thing people open on a phone. The bar used to scroll
 * sideways there, which put Share — the reason the link exists — off the right
 * edge, and squeezed the title down to nothing.
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('fits the whole top bar on screen, Share included', async ({ page }) => {
    const created = await createPreview(SITE, 'A rather long preview title');
    await openAsOwner(page, created);

    const overflow = await page
      .locator('.topbar')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // Every control is reachable without scrolling the bar.
    for (const name of ['Share', 'Update']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, name).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(375);
    }

    // The version menu says just the number, so the browser has nothing to
    // truncate mid-character.
    await expect(page.locator('.topbar .select option')).toHaveText(['v1']);

    // And the title keeps enough room to say something, since it is the only
    // thing on the bar that tells you which preview you are looking at.
    const title = page.locator('.topbar__title');
    await expect(title).toHaveText('A rather long preview title');
    expect((await title.boundingBox())!.width).toBeGreaterThan(60);
  });
});

/*
 * The tab is the only place a review can reach you while you are working
 * somewhere else — there is no server push, so the screen polls.
 *
 * Headless Chromium reports every tab as focused and visible, so leaving is
 * dispatched here rather than caused. Everything downstream is the real thing:
 * the poll, the count, the title and the icon the app actually draws.
 */
test.describe('while you are working somewhere else', () => {
  const leave = (hidden: boolean) => (state: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (state ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  /*
   * The screen renders an empty comment list while the request is in flight.
   * Taking that as the baseline made every comment a preview already had look
   * like it arrived while you were away: opening a sample said "(3)" before
   * anyone had touched it. Loading the whole page away from the tab is the only
   * way to see it.
   */
  test('does not count what was already there before you opened it', async ({ page }) => {
    const created = await createPreview(SITE, 'Acme');
    await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...asNewClient() },
      body: JSON.stringify({ authorName: 'Mika', body: 'Existing feedback.' }),
    });

    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
    });
    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.locator('.thread')).toHaveCount(1);

    await expect(page).toHaveTitle('Acme');
    // And it stays that way across a poll, rather than arriving late.
    await page.waitForTimeout(COMMENT_POLL_MS + 3_000);
    await expect(page).toHaveTitle('Acme');
  });

  test('counts what arrived on the tab, and clears it when you come back', async ({ page }) => {
    const created = await createPreview(SITE, 'Acme');
    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.frameLocator('iframe[title="Preview content"]').locator('h1')).toBeVisible();
    await expect(page).toHaveTitle('Acme');

    await page.evaluate(leave(true), true);

    await fetch(`${API}/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...asNewClient() },
      body: JSON.stringify({ authorName: 'Mika', body: 'The hero is too tall.' }),
    });

    // The poll is the only way this can arrive.
    await expect(page).toHaveTitle('(1) Acme', { timeout: 30_000 });
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(decodeURIComponent(icon ?? '')).toContain('>1</text>');

    // Back at the screen, the sidebar is the answer and the badge is noise.
    await page.evaluate(leave(false), false);
    await expect(page).toHaveTitle('Acme');
    const cleared = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(decodeURIComponent(cleared ?? '')).toContain('fill="none"');
  });
});

/*
 * Notification permission is per origin and every preview has its own, so
 * asking on the review screen would ask again for every preview anyone opens.
 * The screen sends the owner to one notification origin instead, carrying a
 * grant good for one thing — and never the owner token, which is the
 * credential for everything.
 *
 * What happens on that page needs a permission prompt, which headless Chromium
 * will not grant. This covers everything up to the handover.
 */
test.describe('setting up notifications', () => {
  test('sends the owner off with a grant, not with their token', async ({ page }) => {
    const created = await createPreview(SITE, 'Acme');
    await openAsOwner(page, created);

    /*
     * The handover is captured rather than followed: the page it opens spends
     * the grant and strips it from its own URL immediately, so by the time a
     * popup can be inspected the thing under test is gone.
     */
    await page.evaluate(() => {
      (window as unknown as { opened: string[] }).opened = [];
      window.open = ((url: string, target: string, features: string) => {
        (window as unknown as { opened: string[] }).opened.push(`${url} ${target} ${features}`);
        return null;
      }) as typeof window.open;
    });

    await page.getByRole('button', { name: 'Owner settings' }).click();
    await page.getByRole('button', { name: /notify me about comments/i }).click();

    // The screen trades the owner token for the grant first, so the handover
    // happens a round trip after the click.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened.length))
      .toBe(1);

    const opened = await page.evaluate(
      () => (window as unknown as { opened: string[] }).opened[0] ?? '',
    );
    const [href, target, features] = opened.split(' ');
    expect(target).toBe('_blank');
    // No opener, so the notification origin cannot reach back into the review.
    expect(features).toBe('noopener');

    const url = new URL(href!);
    expect(url.origin).toBe('http://notification.localhost:8787');

    const grant = new URLSearchParams(url.hash.slice(1));
    // Its own prefix: a content grant can never be spent as this one.
    expect(grant.get('t')).toMatch(/^w1\./);
    expect(grant.get('title')).toBe('Acme');
    expect(grant.get('back')).toContain(created.preview.slug);

    // The owner token stays on the review origin. The whole URL, not just the
    // query string, which is the easy half to get right.
    expect(href).not.toContain(created.ownerToken);
    expect(href).not.toContain('liha_ot_');
  });

  test('is offered only to the owner', async ({ page }) => {
    const created = await createPreview(SITE, 'Acme');
    await page.goto(`/p/${created.preview.slug}`);
    await expect(page.locator('iframe[title="Preview content"]')).toBeVisible();

    // No owner, no settings dialog to put it in.
    await expect(page.getByRole('button', { name: 'Owner settings' })).toHaveCount(0);
  });
});
