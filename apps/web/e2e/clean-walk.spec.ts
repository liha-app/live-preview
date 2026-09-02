/*
 * The whole product, walked the way somebody meeting it walks it, with the
 * browser's own complaints treated as failures.
 *
 * The other suites assert that particular things work. This one asserts that
 * nothing is quietly broken along the way: no console error, no failed request,
 * no 4xx, in either language and either theme. Those are the faults nobody
 * reports and everybody notices.
 */
import { expect, test, type Page } from '@playwright/test';
import { skipIntro, skipAccountPrompt } from './home.js';

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 160)));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (!why.includes('ERR_ABORTED'))
      problems.push(`requestfailed: ${r.url().slice(0, 90)} ${why}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url().slice(0, 90)}`);
  });
  return problems;
}

async function sample(page: Page) {
  await page.getByRole('button', { name: /see a sample|サンプルを見る/i }).click();
  await page.waitForURL(/\/p\//);
  await expect(page.frameLocator('iframe[title="Preview content"]').locator('h1')).toBeVisible();
}

for (const locale of ['en', 'ja']) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`clean walk — ${locale} / ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await skipIntro(page);
      await skipAccountPrompt(page);
      // This runs in every frame, including the sandboxed artifact, where
      // touching storage throws. The app guards its own reads; the test must too.
      await page.addInitScript((l) => {
        try {
          localStorage.setItem('liha.locale', l);
        } catch {
          /* an opaque origin has no storage, and does not need this */
        }
      }, locale);

      const problems = watch(page);

      await page.goto('/');
      await page.waitForTimeout(600);
      await sample(page);
      await page.waitForTimeout(600);

      // Every dialog a reviewer can reach.
      for (const name of [/share|共有/i, /agent|エージェント/i]) {
        const b = page.getByRole('button', { name }).first();
        if (await b.count()) {
          await b.click();
          await page.waitForTimeout(300);
          await page.keyboard.press('Escape');
        }
      }

      await page.goto('/me');
      await page.waitForTimeout(600);

      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}
