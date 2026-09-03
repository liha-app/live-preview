#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINE_LENGTH = 42;
const MAX_LINES = 2;
const MIN_CUE_SECONDS = 1.2;
const LEAD_IN_SECONDS = 0.8;

type Scene = {
  number: string;
  paragraphs: string[];
};

type TimelineScene = {
  number: string;
  start: number;
  end: number;
  length: number;
  audioFile: string;
};

type Cue = {
  start: number;
  end: number;
  lines: string[];
};

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
  return scenes;
}

function parseClock(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid timeline clock: ${value}`);
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseTimeline(markdown: string): TimelineScene[] {
  const scenes: TimelineScene[] = [];
  const row =
    /^\|\s*(\d+)\s+[^|]*\|\s*([\d:]+)\s*\|\s*([\d:]+)\s*\|\s*([\d.]+)s\s*\|\s*`([^`]+)`\s*\|/;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(row);
    if (!match) continue;
    const start = parseClock(match[2]);
    const end = parseClock(match[3]);
    const length = Number(match[4]);
    if (Math.abs(end - start - length) > 0.01) {
      throw new Error(`Timeline scene ${match[1]} has inconsistent in/out/len values`);
    }
    scenes.push({
      number: match[1].padStart(2, '0'),
      start,
      end,
      length,
      audioFile: match[5],
    });
  }
  if (scenes.length !== 7) throw new Error(`Expected 7 timeline scenes, found ${scenes.length}`);
  return scenes;
}

function readWavDuration(wav: Buffer, fileName: string): number {
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(`${fileName} is not a RIFF/WAVE file`);
  }

  let offset = 12;
  let byteRate = 0;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > wav.length) throw new Error(`${fileName} has a truncated ${id} chunk`);
    if (id === 'fmt ' && size >= 16) {
      const format = wav.readUInt16LE(dataOffset);
      if (format !== 1) throw new Error(`${fileName} is not PCM audio`);
      channels = wav.readUInt16LE(dataOffset + 2);
      sampleRate = wav.readUInt32LE(dataOffset + 4);
      byteRate = wav.readUInt32LE(dataOffset + 8);
      bitsPerSample = wav.readUInt16LE(dataOffset + 14);
    } else if (id === 'data') {
      dataBytes += size;
    }
    offset = dataOffset + size + (size % 2);
  }

  if (
    sampleRate !== 24_000 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    byteRate === 0 ||
    dataBytes === 0
  ) {
    throw new Error(
      `${fileName} must be 24 kHz mono 16-bit PCM (got ${sampleRate} Hz, ${channels} channel(s), ${bitsPerSample}-bit)`,
    );
  }
  return dataBytes / byteRate;
}

function wrapWords(words: string[]): string[] | undefined {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > MAX_LINE_LENGTH) {
      throw new Error(`Subtitle word is longer than ${MAX_LINE_LENGTH} characters: ${word}`);
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= MAX_LINE_LENGTH) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= MAX_LINES) return undefined;
    }
  }
  if (current) lines.push(current);
  return lines.length <= MAX_LINES ? lines : undefined;
}

function splitIntoCues(words: string[], audioDuration: number): string[][] {
  type Solution = { chunks: string[][]; score: number };
  const memo = new Map<number, Solution | null>();

  const solve = (start: number): Solution | null => {
    if (start === words.length) return { chunks: [], score: 0 };
    if (memo.has(start)) return memo.get(start) ?? null;

    let best: Solution | null = null;
    for (let end = start + 1; end <= words.length; end += 1) {
      const chunk = words.slice(start, end);
      const lines = wrapWords(chunk);
      if (!lines) break;
      const duration = (chunk.length / words.length) * audioDuration;
      if (duration + 1e-9 < MIN_CUE_SECONDS) continue;

      const rest = solve(end);
      if (!rest) continue;
      const endsSentence = /[.!?][”"']?$/.test(chunk.at(-1) ?? '');
      const characterCount = lines.reduce((sum, line) => sum + line.length, 0);
      const score =
        rest.score +
        (endsSentence || end === words.length ? 0 : 80) +
        Math.abs(70 - characterCount);
      if (!best || score < best.score) best = { chunks: [chunk, ...rest.chunks], score };
    }

    memo.set(start, best);
    return best;
  };

  const solution = solve(0);
  if (!solution) {
    throw new Error(
      `Could not split ${words.length} words into two-line cues of at least ${MIN_CUE_SECONDS.toFixed(1)}s`,
    );
  }
  return solution.chunks;
}

function formatSrtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

async function main(): Promise<void> {
  const toolsDir = path.dirname(fileURLToPath(import.meta.url));
  const videoDir = path.resolve(toolsDir, '..');
  const [narrationMarkdown, timelineMarkdown] = await Promise.all([
    readFile(path.join(videoDir, 'script', 'narration.md'), 'utf8'),
    readFile(path.join(videoDir, 'script', 'timeline.md'), 'utf8'),
  ]);
  const narration = parseNarration(narrationMarkdown);
  const timeline = parseTimeline(timelineMarkdown);
  const cues: Cue[] = [];

  for (const timedScene of timeline) {
    const scene = narration.find((candidate) => candidate.number === timedScene.number);
    if (!scene || scene.paragraphs.length === 0) {
      throw new Error(`Narration is missing scene ${timedScene.number}`);
    }
    const wavPath = path.join(videoDir, 'narration', timedScene.audioFile);
    const audioDuration = readWavDuration(await readFile(wavPath), timedScene.audioFile);
    if (audioDuration > timedScene.length + 0.001) {
      throw new Error(
        `${timedScene.audioFile} is ${audioDuration.toFixed(2)}s, longer than its ${timedScene.length.toFixed(2)}s timeline slot`,
      );
    }

    const words = scene.paragraphs.join(' ').split(/\s+/).filter(Boolean);
    const chunks = splitIntoCues(words, audioDuration);
    let elapsedWords = 0;
    for (const chunk of chunks) {
      const start =
        timedScene.start + LEAD_IN_SECONDS + (elapsedWords / words.length) * audioDuration;
      elapsedWords += chunk.length;
      const end =
        timedScene.start + LEAD_IN_SECONDS + (elapsedWords / words.length) * audioDuration;
      const lines = wrapWords(chunk);
      if (!lines) throw new Error(`Internal subtitle wrapping error in scene ${timedScene.number}`);
      if (Math.round(end * 1_000) - Math.round(start * 1_000) < MIN_CUE_SECONDS * 1_000) {
        throw new Error(
          `Internal subtitle timing error: cue shorter than ${MIN_CUE_SECONDS.toFixed(1)}s`,
        );
      }
      cues.push({ start, end, lines });
    }
  }

  const output = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.lines.join('\n')}\n`,
    )
    .join('\n');
  const subtitlesDir = path.join(videoDir, 'subtitles');
  const outputPath = path.join(subtitlesDir, 'live-preview-demo.srt');
  await mkdir(subtitlesDir, { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  console.log(`Wrote ${cues.length} cues to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
