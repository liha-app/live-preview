/*
 * Records the demo, scene by scene, in real Chrome against the live deployment.
 *
 * Real Chrome and not Playwright's Chromium, because Chrome is where WebMCP
 * actually exists: the app ships an origin trial token, so `document.modelContext`
 * is the browser's own — `getTools()` returns the page's real tools and
 * `executeTool()` runs them. Nothing in scene 4 is a stand-in.
 *
 * Every pointer move is written down, so there is no wandering and no take
 * where somebody hunts for a button.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = join(ROOT, 'video/raw');
const RECORDINGS = join(ROOT, 'video/recordings');
mkdirSync(OUT, { recursive: true });
mkdirSync(RECORDINGS, { recursive: true });

const fixture = JSON.parse(readFileSync(join(OUT, 'fixture.json'), 'utf8'));
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const SIZE = { width: 1600, height: 900 };

async function open(scene, { storageState } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
  });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 2,
    recordVideo: { dir: join(OUT, scene), size: SIZE },
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('liha.seen-intro', '1');
      localStorage.setItem('liha.no-account-prompt', '1');
      localStorage.setItem('liha.locale', 'en');
      localStorage.setItem('liha.reviewer-name', 'Mika (product)');
    } catch {
      /* opaque origin */
    }
  });
  return { browser, context, page };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Moves once, deliberately, then clicks. No hunting. */
async function clickSlowly(page, locator, { steps = 12, settle = 420 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to click');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await wait(220);
  await page.mouse.down();
  await wait(70);
  await page.mouse.up();
  await wait(settle);
}

async function finish(handle, scene) {
  const video = handle.page.video();
  await handle.context.close();
  await handle.browser.close();
  if (!video) throw new Error(`recording was not enabled for ${scene}`);
  const rawPath = await video.path();
  const outputPath = join(RECORDINGS, `${scene}.mp4`);
  const encoded = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      rawPath,
      '-vf',
      'fps=30,scale=1920:1080:flags=lanczos,setsar=1',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { encoding: 'utf8' },
  );
  if (encoded.status !== 0) {
    throw new Error(
      `ffmpeg failed for ${scene}: ${encoded.stderr.trim() || `exit ${encoded.status}`}`,
    );
  }
  console.log(`  recorded ${scene} -> ${outputPath}`);
}

export { open, wait, clickSlowly, finish, fixture, only, OUT, RECORDINGS };
