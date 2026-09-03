#!/usr/bin/env node
/*
 * Renders the share card to apps/web/public/og.png.
 *
 * The card is HTML rather than a drawing program's export so it stays in the
 * same hand as the landing page: the same tokens, the same handwriting, the
 * same off-square corners. Run it again after changing scripts/og-card.html.
 *
 *   node scripts/make-og.mjs
 *
 * Needs network the first time, for the Google fonts the card is set in. The
 * PNG is committed, so a build never depends on this.
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const template = join(here, 'og-card.html');
const out = join(here, '..', 'apps', 'web', 'public', 'og.png');

/* 1200x630 is what Slack, X and iMessage all crop from. */
const SIZE = { width: 1200, height: 630 };

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });

await page.goto(pathToFileURL(template).href, { waitUntil: 'networkidle' });

/*
 * The card is set in Yomogi. Screenshotting before it arrives bakes a fallback
 * face into a file nobody looks at again, so wait for the real one rather than
 * for a timeout.
 */
await page.waitForFunction(() => document.fonts.check('16px Yomogi'), null, { timeout: 15_000 });
await page.evaluate(() => document.fonts.ready);

await page.screenshot({ path: out, type: 'png' });
await browser.close();

const { size } = await stat(out);
console.log(`og.png  ${SIZE.width}x${SIZE.height}  ${(size / 1024).toFixed(0)} KB`);
