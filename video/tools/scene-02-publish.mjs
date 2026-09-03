import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureTerminal } from './terminal-capture.mjs';
import { finish, open, RECORDINGS, wait } from './record.mjs';

const scene = '02-publish';
const root = fileURLToPath(new URL('../..', import.meta.url));
const workDir = await mkdtemp(join(tmpdir(), 'liha-publish-demo-'));
const terminalClip = join(root, 'video/raw/02-terminal.mp4');
const browserScene = '02-publish-browser';
const browserClip = join(RECORDINGS, `${browserScene}.mp4`);
const output = join(RECORDINGS, `${scene}.mp4`);

try {
  await cp(join(root, 'video/fixtures/northwind'), workDir, { recursive: true });
  const terminal = await captureTerminal({
    cwd: workDir,
    command: 'npx @liha-cli/live-preview deploy .',
    output: terminalClip,
    settleMs: 4_500,
  });
  const shareUrl = terminal.match(/https:\/\/lp-[a-z0-9-]+\.liha\.review/i)?.[0];
  if (!shareUrl) throw new Error('CLI completed without a share URL');

  const handle = await open(browserScene);
  try {
    await handle.page.goto(shareUrl, { waitUntil: 'domcontentloaded' });
    await handle.page.frameLocator('iframe[title="Preview content"]').locator('#cta').waitFor();
    await wait(5_000);
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
  if (combined.status !== 0) throw new Error(combined.stderr.trim() || 'scene 02 concat failed');
  console.log(`  recorded ${scene} -> ${output}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
  await rm(browserClip, { force: true });
}
