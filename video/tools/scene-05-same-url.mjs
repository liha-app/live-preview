import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureTerminal } from './terminal-capture.mjs';
import { clickSlowly, finish, fixture, open, RECORDINGS, wait } from './record.mjs';

const scene = '05-same-url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const workDir = await mkdtemp(join(tmpdir(), 'liha-update-demo-'));
const terminalClip = join(root, 'video/raw/05-terminal.mp4');
const browserScene = '05-same-url-browser';
const browserClip = join(RECORDINGS, `${browserScene}.mp4`);
const output = join(RECORDINGS, `${scene}.mp4`);
const browserOnly = process.env.LIHA_SCENE5_BROWSER_ONLY === '1';

try {
  await cp(join(root, 'video/fixtures/northwind'), workDir, { recursive: true });
  const cssPath = join(workDir, 'assets/site.css');
  const css = await readFile(cssPath, 'utf8');
  await writeFile(
    cssPath,
    css.replace('.cta{padding:26px 52px;font-size:26px;', '.cta{padding:16px 28px;font-size:16px;'),
    'utf8',
  );
  await writeFile(
    join(workDir, '.liha.json'),
    `${JSON.stringify(
      {
        previewId: fixture.previewId,
        slug: fixture.slug,
        apiUrl: 'https://api-livepreview.liha.dev',
        shareUrl: fixture.shareUrl,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (!browserOnly) {
    await captureTerminal({
      cwd: workDir,
      command: 'npx @liha-cli/live-preview deploy .',
      output: terminalClip,
      environment: { LIHA_OWNER_TOKEN: fixture.ownerToken },
      settleMs: 2_000,
    });
  }

  const handle = await open(browserScene);
  try {
    await handle.page.goto(fixture.ownerUrl, { waitUntil: 'domcontentloaded' });
    const cta = handle.page.frameLocator('iframe[title="Preview content"]').locator('#cta');
    await cta.waitFor();
    const version = handle.page.getByRole('combobox', { name: 'Version' });
    if (await version.count()) {
      const v2 = await version
        .locator('option')
        .evaluateAll(
          (options) => options.find((option) => option.textContent?.includes('v2'))?.value,
        );
      if (v2) await version.selectOption(v2);
      await wait(900);
    }
    const resolve = handle.page.getByRole('button', { name: 'Resolve', exact: true });
    if (await resolve.isVisible().catch(() => false)) {
      await clickSlowly(handle.page, resolve);
      await handle.page.getByRole('button', { name: 'Open 0' }).waitFor();
    }
    const resolved = handle.page.getByRole('button', { name: /Resolved 1/ });
    if (await resolved.isVisible().catch(() => false)) {
      await clickSlowly(handle.page, resolved);
    }
    await wait(3_000);
  } finally {
    await finish(handle, browserScene);
  }

  const combined = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      terminalClip,
      '-i',
      browserClip,
      '-filter_complex',
      '[0:v]fps=30,setpts=PTS-STARTPTS[v0];[1:v]fps=30,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
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
      output,
    ],
    { encoding: 'utf8' },
  );
  if (combined.status !== 0) throw new Error(combined.stderr.trim() || 'scene 05 concat failed');
  console.log(`  recorded ${scene} -> ${output}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
  await rm(browserClip, { force: true });
}
