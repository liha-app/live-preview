import { expect, test, type Page } from '@playwright/test';

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
  const response = await fetch(`${API}/api/previews`, { method: 'POST', body: form });
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
    const created = (await fetch(`${API}/api/previews`, { method: 'POST', body: form }).then((r) =>
      r.json(),
    )) as Created;

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
