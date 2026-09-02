import { expect, test } from '@playwright/test';
import { skipIntro, skipAccountPrompt } from './home.js';
import { asNewClient } from './clients.js';

const API = 'http://localhost:8787';
const SITE =
  '<!doctype html><html><head><meta charset=utf-8><title>Acme</title></head><body><h1>Ship faster</h1><button id="cta">Get started</button></body></html>';

test.beforeEach(({ page }) => skipAccountPrompt(page));

async function make() {
  const form = new FormData();
  form.append('title', 'Acme');
  form.append('files', new File([SITE], 'index.html'));
  form.append('paths', JSON.stringify(['index.html']));
  return (await (
    await fetch(`${API}/api/previews`, { method: 'POST', headers: asNewClient(), body: form })
  ).json()) as { preview: { slug: string }; ownerToken: string };
}

/*
 * Where focus is, at every stop, in the app's own colours.
 *
 * axe cannot see this: an element can pass every contrast and label rule and
 * still take focus invisibly. Tabbing through is the only way to find out, and
 * the artifact iframe was one — focus appeared to vanish for a stop.
 */
test('every focus stop is visible', async ({ page }) => {
  const created = await make();
  await skipIntro(page);
  await page.goto(`/p/${created.preview.slug}`);
  await expect(page.locator('iframe[title="Preview content"]')).toBeVisible();

  const invisible: string[] = [];
  for (let i = 0; i < 22; i += 1) {
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      /*
       * Tab into the artifact and this frame reports the iframe as the active
       * element while `:focus` does not match it — focus has passed into the
       * artifact's own document, where its own indicators apply. There is
       * nothing for this side to draw.
       */
      if (el.tagName === 'IFRAME') return null;
      const s = getComputedStyle(el);
      const ring =
        s.outlineStyle !== 'none' ||
        s.boxShadow !== 'none' ||
        s.borderColor !== getComputedStyle(el.parentElement ?? el).borderColor;
      return {
        tag: el.tagName,
        label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 26),
        ring,
      };
    });
    if (seen && !seen.ring) invisible.push(`${seen.tag} "${seen.label}"`);
  }
  expect(invisible, invisible.join(', ')).toEqual([]);
});
