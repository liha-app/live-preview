#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINE_LENGTH = 28;
const MAX_CUE_LENGTH = MAX_LINE_LENGTH * 2;
const LEAD_IN_SECONDS = 0.8;
const MIN_CUE_SECONDS = 1.15;

type Scene = { number: string; text: string };
type TimelineScene = { number: string; start: number; length: number; audioFile: string };
type Cue = { start: number; end: number; lines: string[] };

function parseNarration(markdown: string): Scene[] {
  const scenes: Array<{ number: string; paragraphs: string[] }> = [];
  let current: { number: string; paragraphs: string[] } | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (current && paragraph.length > 0) current.paragraphs.push(paragraph.join(''));
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
    if (!quote || quote[1].trim() === '') flush();
    else paragraph.push(quote[1].trim());
  }
  flush();
  return scenes.map((scene) => ({ number: scene.number, text: scene.paragraphs.join('') }));
}

function parseClock(value: string): number {
  return value
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

function parseTimeline(markdown: string): TimelineScene[] {
  const scenes: TimelineScene[] = [];
  const row =
    /^\|\s*(\d+)\s+[^|]*\|\s*([\d:]+)\s*\|\s*[\d:]+\s*\|\s*([\d.]+)s\s*\|\s*`([^`]+)`\s*\|/;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(row);
    if (!match) continue;
    scenes.push({
      number: match[1].padStart(2, '0'),
      start: parseClock(match[2]),
      length: Number(match[3]),
      audioFile: match[4],
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
  let dataBytes = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (id === 'fmt ' && size >= 16) byteRate = wav.readUInt32LE(dataOffset + 8);
    if (id === 'data') dataBytes += size;
    offset = dataOffset + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new Error(`Could not read PCM duration from ${fileName}`);
  return dataBytes / byteRate;
}

function graphemes(text: string): string[] {
  return Array.from(text);
}

function splitLongSentence(sentence: string): string[] {
  const chars = graphemes(sentence);
  if (chars.length <= MAX_CUE_LENGTH) return [sentence];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < chars.length) {
    let end = Math.min(cursor + MAX_CUE_LENGTH, chars.length);
    if (end < chars.length) {
      const lowerBound = cursor + Math.floor(MAX_CUE_LENGTH * 0.5);
      for (let index = end - 1; index >= lowerBound; index -= 1) {
        if (/[、，：；]/.test(chars[index])) {
          end = index + 1;
          break;
        }
      }
    }
    chunks.push(chars.slice(cursor, end).join(''));
    cursor = end;
  }
  return chunks;
}

function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^。！？]+[。！？]?/gu)?.filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) chunks.push(...splitLongSentence(sentence));
  return chunks;
}

function wrapJapanese(text: string): string[] {
  if (graphemes(text).length <= MAX_LINE_LENGTH) return [text];
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  const words = Array.from(segmenter.segment(text), ({ segment }) => segment);
  let best: { index: number; score: number } | undefined;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join('');
    const right = words.slice(index).join('');
    const leftLength = graphemes(left).length;
    const rightLength = graphemes(right).length;
    if (leftLength > MAX_LINE_LENGTH || rightLength > MAX_LINE_LENGTH) continue;
    let score = Math.abs(leftLength - rightLength);
    if (/[、。，．！？：；]$/u.test(left)) score -= 8;
    if (/^[、。，．！？：；]/u.test(right)) score += 8;
    if (/\p{Script=Hiragana}$/u.test(left) && /^\p{Script=Hiragana}/u.test(right)) score += 5;
    if (/\p{Script=Katakana}$/u.test(left) && /^\p{Script=Katakana}/u.test(right)) score += 8;
    if (!best || score < best.score) best = { index, score };
  }
  if (!best) throw new Error(`Japanese cue cannot fit two lines: ${text}`);
  return [words.slice(0, best.index).join(''), words.slice(best.index).join('')];
}

function mergeShortChunks(chunks: string[], audioDuration: number): string[] {
  const totalCharacters = chunks.reduce((sum, chunk) => sum + graphemes(chunk).length, 0);
  const merged: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const duration = (graphemes(chunk).length / totalCharacters) * audioDuration;
    const next = chunks[index + 1];
    if (duration < MIN_CUE_SECONDS && next && graphemes(chunk + next).length <= MAX_CUE_LENGTH) {
      merged.push(chunk + next);
      index += 1;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
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
    readFile(path.join(videoDir, 'script', 'narration.ja.md'), 'utf8'),
    readFile(path.join(videoDir, 'script', 'timeline.md'), 'utf8'),
  ]);
  const narration = parseNarration(narrationMarkdown);
  const timeline = parseTimeline(timelineMarkdown);
  const cues: Cue[] = [];

  for (const timedScene of timeline) {
    const scene = narration.find((candidate) => candidate.number === timedScene.number);
    if (!scene?.text) throw new Error(`Narration is missing scene ${timedScene.number}`);
    const wavPath = path.join(videoDir, 'narration-ja', timedScene.audioFile);
    const audioDuration = readWavDuration(await readFile(wavPath), timedScene.audioFile);
    if (audioDuration + LEAD_IN_SECONDS > timedScene.length + 0.001) {
      throw new Error(`${timedScene.audioFile} does not fit scene ${timedScene.number}`);
    }

    const chunks = mergeShortChunks(splitIntoChunks(scene.text), audioDuration);
    const totalCharacters = chunks.reduce((sum, chunk) => sum + graphemes(chunk).length, 0);
    let elapsedCharacters = 0;
    for (const chunk of chunks) {
      const start =
        timedScene.start + LEAD_IN_SECONDS + (elapsedCharacters / totalCharacters) * audioDuration;
      elapsedCharacters += graphemes(chunk).length;
      const end =
        timedScene.start + LEAD_IN_SECONDS + (elapsedCharacters / totalCharacters) * audioDuration;
      cues.push({ start, end, lines: wrapJapanese(chunk) });
    }
  }

  const output = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.lines.join('\n')}\n`,
    )
    .join('\n');
  const subtitlesDir = path.join(videoDir, 'subtitles');
  const outputPath = path.join(subtitlesDir, 'live-preview-demo-ja.srt');
  await mkdir(subtitlesDir, { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  console.log(`Wrote ${cues.length} Japanese cues to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
