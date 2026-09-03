#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = join(root, 'video/script/narration.ja.md');
const outputDirectory = join(root, 'video/narration-ja');
const voice = process.env.LIHA_JA_VOICE ?? 'Kyoko';
const baseRate = Number(process.env.LIHA_JA_RATE ?? 220);
const force = process.argv.includes('--force');
const requestedScene = process.argv.find((arg) => arg.startsWith('--scene='))?.slice(8);

const files = {
  '01': '01-hook.wav',
  '02': '02-publish.wav',
  '03': '03-review.wav',
  '04': '04-agent.wav',
  '05': '05-same-url.wav',
  '06': '06-product.wav',
  '07': '07-closing.wav',
};

// Leave room for the 0.8-second picture lead and a short visual tail.
const maximumSeconds = {
  '01': 17.0,
  '02': 19.0,
  '03': 23.0,
  '04': 40.5,
  '05': 17.0,
  '06': 12.0,
  '07': 13.0,
};

function scenesFrom(markdown) {
  const scenes = [];
  let current = null;
  let paragraph = [];
  const flush = () => {
    if (current && paragraph.length) current.paragraphs.push(paragraph.join(''));
    paragraph = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d{2})\s+[—-]/);
    if (heading) {
      flush();
      current = { number: heading[1], paragraphs: [] };
      scenes.push(current);
      continue;
    }
    if (!current) continue;
    const quote = line.match(/^>\s?(.*)$/);
    if (!quote) {
      flush();
    } else if (!quote[1].trim()) {
      flush();
    } else {
      paragraph.push(quote[1].trim());
    }
  }
  flush();
  return scenes.filter((scene) => files[scene.number]);
}

function duration(path) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'ffprobe failed');
  return Number(result.stdout.trim());
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} failed`);
}

const scenes = scenesFrom(await readFile(source, 'utf8'));
await mkdir(outputDirectory, { recursive: true });

for (const scene of scenes) {
  if (requestedScene && scene.number !== requestedScene.padStart(2, '0')) continue;
  const output = join(outputDirectory, files[scene.number]);
  if (!force) {
    try {
      console.log(`${files[scene.number]}: skipped (${duration(output).toFixed(2)}s)`);
      continue;
    } catch {
      // Generate a missing or invalid take.
    }
  }

  const temporary = await mkdtemp(join(tmpdir(), `liha-ja-${scene.number}-`));
  try {
    const aiff = join(temporary, 'take.aiff');
    let rate = baseRate;
    let measured = Infinity;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      run('say', [
        '-v',
        voice,
        '-r',
        String(Math.round(rate)),
        '-o',
        aiff,
        scene.paragraphs.join('\n'),
      ]);
      run('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        aiff,
        '-ar',
        '24000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        output,
      ]);
      measured = duration(output);
      if (measured <= maximumSeconds[scene.number]) break;
      rate = Math.min(310, rate * (measured / maximumSeconds[scene.number]) * 1.04);
    }
    if (measured > maximumSeconds[scene.number]) {
      throw new Error(
        `scene ${scene.number} is ${measured.toFixed(2)}s, over ${maximumSeconds[scene.number]}s`,
      );
    }
    console.log(`${files[scene.number]}: ${measured.toFixed(2)}s at voice ${voice}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
