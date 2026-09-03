#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'gemini-3.1-flash-tts-preview';
const VOICE = 'Kore';
const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const ENGLISH_STYLE =
  'Natural American English. Confident, calm, technically credible, concise, ' +
  'and slightly energetic; not salesy and not theatrical. Sound like a developer ' +
  'showing a colleague something that works at a developer conference. Pronounce ' +
  'WebMCP, CLI, DOM, and CSS clearly.';
const JAPANESE_STYLE =
  'Natural Japanese. Confident, calm, technically credible, concise, and slightly energetic; ' +
  'not salesy and not theatrical. Sound like a developer showing a colleague something that works. ' +
  'Pronounce Liha as リハ, WebMCP as ウェブ・エム・シー・ピー, CSS as シー・エス・エス, and URL as ユー・アール・エル.';

const sceneFiles: Record<string, string> = {
  '01': '01-hook.wav',
  '02': '02-publish.wav',
  '03': '03-review.wav',
  '04': '04-agent.wav',
  '05': '05-same-url.wav',
  '06': '06-product.wav',
  '07': '07-closing.wav',
};

const sceneMaxSeconds: Record<string, number> = {
  '01': 17,
  '02': 19,
  '03': 23,
  '04': 41,
  '05': 17,
  '06': 12,
  '07': 13,
};
const japaneseSceneMaxSeconds: Record<string, number> = {
  '01': 17,
  '02': 19,
  '03': 23,
  '04': 41,
  '05': 17,
  '06': 12,
  '07': 13,
};

type Scene = {
  number: string;
  paragraphs: string[];
};

type Options = {
  force: boolean;
  locale: 'en' | 'ja';
  scene?: string;
};

class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function usage(): string {
  return [
    'Usage: node --experimental-strip-types video/tools/generate-narration.ts [options]',
    '',
    'Options:',
    '  --force       Replace WAV files that already exist',
    '  --locale CODE Generate English (en, default) or Japanese (ja)',
    '  --scene NN    Generate only one scene (01 through 07)',
    '  --help        Show this help',
  ].join('\n');
}

function parseArgs(args: string[]): Options | 'help' {
  const options: Options = { force: false, locale: 'en' };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return 'help';
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--locale') {
      const value = args[index + 1];
      if (value !== 'en' && value !== 'ja') throw new Error('--locale must be en or ja');
      options.locale = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--locale=')) {
      const value = arg.slice('--locale='.length);
      if (value !== 'en' && value !== 'ja') throw new Error('--locale must be en or ja');
      options.locale = value;
      continue;
    }
    if (arg === '--scene') {
      const value = args[index + 1];
      if (!value) throw new Error('--scene requires a scene number (01 through 07)');
      options.scene = value.padStart(2, '0');
      index += 1;
      continue;
    }
    if (arg.startsWith('--scene=')) {
      options.scene = arg.slice('--scene='.length).padStart(2, '0');
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.scene && !sceneFiles[options.scene]) {
    throw new Error(`Unknown scene ${options.scene}; expected 01 through 07`);
  }
  return options;
}

function parseNarration(markdown: string): Scene[] {
  const scenes: Scene[] = [];
  let current: Scene | undefined;
  let paragraph: string[] = [];

  const finishParagraph = () => {
    if (current && paragraph.length > 0) {
      current.paragraphs.push(paragraph.join(' ').replace(/\s+/g, ' ').trim());
      paragraph = [];
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d{2})\s+[—-]\s+/);
    if (heading) {
      finishParagraph();
      current = { number: heading[1], paragraphs: [] };
      scenes.push(current);
      continue;
    }
    if (!current) continue;

    const quote = line.match(/^>\s?(.*)$/);
    if (!quote) {
      finishParagraph();
      continue;
    }
    if (quote[1].trim() === '') finishParagraph();
    else paragraph.push(quote[1].trim());
  }
  finishParagraph();

  for (const [number, fileName] of Object.entries(sceneFiles)) {
    const scene = scenes.find((candidate) => candidate.number === number);
    if (!scene || scene.paragraphs.length === 0) {
      throw new Error(`No blockquote narration found for scene ${number} (${fileName})`);
    }
  }
  return scenes.filter((scene) => sceneFiles[scene.number]);
}

function makePrompt(scene: Scene, locale: 'en' | 'ja'): string {
  const style = locale === 'ja' ? JAPANESE_STYLE : ENGLISH_STYLE;
  const maximumSeconds =
    locale === 'ja' ? japaneseSceneMaxSeconds[scene.number] : sceneMaxSeconds[scene.number];
  return [
    'Read aloud only the narration below. Do not speak these directions.',
    `Delivery: ${style}`,
    `Timing target: aim to finish between ${maximumSeconds - 2} and ${maximumSeconds} seconds, using a natural pace.`,
    `Hard duration limit: finish within ${maximumSeconds} seconds. Speak briskly if needed; do not exceed it.`,
    scene.number === '06'
      ? 'Keep the sentence transition flowing, without a paragraph pause.'
      : 'Use a short, natural pause between paragraphs.',
    '',
    'Narration:',
    scene.paragraphs.join(scene.number === '06' ? ' ' : '\n\n'),
  ].join('\n');
}

function pcmToWav(pcm: Buffer): Buffer {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error(`Gemini returned an invalid ${pcm.length}-byte PCM payload`);
  }

  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavDuration(wav: Buffer): number {
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('File is not a valid RIFF/WAVE file');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > wav.length) throw new Error(`Truncated WAV ${id} chunk`);
    if (id === 'fmt ' && size >= 16) {
      const format = wav.readUInt16LE(dataOffset);
      if (format !== 1) throw new Error(`Expected PCM WAV, received format ${format}`);
      channels = wav.readUInt16LE(dataOffset + 2);
      sampleRate = wav.readUInt32LE(dataOffset + 4);
      bitsPerSample = wav.readUInt16LE(dataOffset + 14);
    } else if (id === 'data') {
      dataBytes += size;
    }
    offset = dataOffset + size + (size % 2);
  }

  if (
    sampleRate !== SAMPLE_RATE ||
    channels !== CHANNELS ||
    bitsPerSample !== BITS_PER_SAMPLE ||
    dataBytes === 0
  ) {
    throw new Error(
      `Expected 24 kHz mono 16-bit PCM WAV; got ${sampleRate} Hz, ${channels} channel(s), ${bitsPerSample}-bit`,
    );
  }
  return dataBytes / (sampleRate * channels * (bitsPerSample / 8));
}

async function fitWavToDuration(wav: Buffer, maximumSeconds: number): Promise<Buffer> {
  const originalDuration = wavDuration(wav);
  const speed = (originalDuration / maximumSeconds) * 1.005;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'liha-gemini-fit-'));
  const inputPath = path.join(temporaryDirectory, 'input.wav');
  const outputPath = path.join(temporaryDirectory, 'output.wav');
  try {
    await writeFile(inputPath, wav);
    const result = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-af',
        `atempo=${speed.toFixed(6)}`,
        '-ar',
        String(SAMPLE_RATE),
        '-ac',
        String(CHANNELS),
        '-c:a',
        'pcm_s16le',
        outputPath,
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw new Error(result.stderr.trim() || 'ffmpeg duration fitting failed');
    const fitted = await readFile(outputPath);
    const fittedDuration = wavDuration(fitted);
    if (fittedDuration > maximumSeconds + 0.001) {
      throw new Error(`duration fitting produced ${fittedDuration.toFixed(2)}s`);
    }
    return fitted;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function extractAudio(payload: unknown): Buffer {
  const response = payload as {
    status?: string;
    error?: { message?: string };
    output_audio?: { type?: string; data?: string; mime_type?: string };
    steps?: Array<{
      type?: string;
      content?: Array<{ type?: string; data?: string; mime_type?: string }>;
    }>;
  };
  if (response.status && response.status !== 'completed') {
    throw new Error(
      response.error?.message || `Gemini interaction ended with status ${response.status}`,
    );
  }

  const audio =
    response.output_audio ??
    response.steps
      ?.filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .find((content) => content.type === 'audio' && content.data);
  if (!audio?.data) throw new Error('Gemini response did not contain inline audio data');

  const bytes = Buffer.from(audio.data, 'base64');
  if (audio.mime_type === 'audio/wav' || bytes.toString('ascii', 0, 4) === 'RIFF') {
    wavDuration(bytes);
    return bytes;
  }
  if (audio.mime_type && !audio.mime_type.toLowerCase().startsWith('audio/l16')) {
    throw new Error(`Gemini returned unsupported audio type ${audio.mime_type}`);
  }
  return pcmToWav(bytes);
}

async function requestAudio(apiKey: string, prompt: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Api-Revision': '2026-05-20',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: VOICE }] },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw new TypeError(`Network error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 1_000);
    throw new HttpError(`Gemini API returned HTTP ${response.status}: ${detail}`, response.status);
  }
  return extractAudio(await response.json());
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof HttpError && error.status >= 500 && error.status <= 599)
  );
}

async function generateWithRetries(
  apiKey: string,
  scene: Scene,
  locale: 'en' | 'ja',
): Promise<Buffer> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestAudio(apiKey, makePrompt(scene, locale));
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
      const delay = RETRY_DELAYS_MS[attempt];
      console.error(
        `Scene ${scene.number} failed (${error instanceof Error ? error.message : String(error)}); ` +
          `retrying in ${delay / 1_000}s (${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(usage());
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Set it with:\nexport GEMINI_API_KEY='YOUR_API_KEY'");
    process.exitCode = 2;
    return;
  }

  const toolsDir = path.dirname(fileURLToPath(import.meta.url));
  const videoDir = path.resolve(toolsDir, '..');
  const sourceFile = parsed.locale === 'ja' ? 'narration.ja.md' : 'narration.md';
  const outputDirectory = parsed.locale === 'ja' ? 'narration-ja' : 'narration';
  const source = await readFile(path.join(videoDir, 'script', sourceFile), 'utf8');
  const scenes = parseNarration(source).filter(
    (scene) => !parsed.scene || scene.number === parsed.scene,
  );
  const failures: string[] = [];
  await mkdir(path.join(videoDir, outputDirectory), { recursive: true });

  for (const scene of scenes) {
    const fileName = sceneFiles[scene.number];
    const outputPath = path.join(videoDir, outputDirectory, fileName);
    if (!parsed.force) {
      try {
        const duration = wavDuration(await readFile(outputPath));
        console.log(`${fileName}: skipped existing WAV (${duration.toFixed(2)}s)`);
        continue;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          failures.push(
            `${scene.number}: existing ${fileName} is invalid: ${(error as Error).message}`,
          );
          continue;
        }
      }
    }

    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    try {
      const maximumSeconds =
        parsed.locale === 'ja'
          ? japaneseSceneMaxSeconds[scene.number]
          : sceneMaxSeconds[scene.number];
      let wav: Buffer | undefined;
      let duration = 0;
      for (let timingAttempt = 0; timingAttempt < 3; timingAttempt += 1) {
        wav = await generateWithRetries(apiKey, scene, parsed.locale);
        duration = wavDuration(wav);
        if (duration <= maximumSeconds + 0.001) break;
        if (duration <= maximumSeconds * 1.08) {
          const originalDuration = duration;
          wav = await fitWavToDuration(wav, maximumSeconds);
          duration = wavDuration(wav);
          console.error(
            `${fileName}: fitted ${originalDuration.toFixed(2)}s take to ${duration.toFixed(2)}s ` +
              `without changing pitch`,
          );
          break;
        }
        if (timingAttempt < 2) {
          console.error(
            `${fileName}: take ${timingAttempt + 1} was ${duration.toFixed(2)}s, over the ` +
              `${maximumSeconds.toFixed(2)}s limit; regenerating`,
          );
        }
      }
      if (!wav || duration > maximumSeconds + 0.001) {
        throw new Error(`could not generate a take within the ${maximumSeconds.toFixed(2)}s limit`);
      }
      await writeFile(temporaryPath, wav, { mode: 0o644 });
      await rename(temporaryPath, outputPath);
      console.log(`${fileName}: ${duration.toFixed(2)}s`);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      failures.push(`${scene.number}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Narration generation failed for ${failures.length} scene(s):\n${failures.join('\n')}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
