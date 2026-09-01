/** Terminal output and prompts for scripts/deploy.mjs. */

import readline from 'node:readline';

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const code = (value) => (enabled ? `[${value}m` : '');

export const style = {
  reset: code(0),
  bold: code(1),
  dim: code(2),
  red: code(31),
  green: code(32),
  yellow: code(33),
  blue: code(34),
};

const { reset, bold, dim, red, green, yellow, blue } = style;

let stepNumber = 0;

export function step(title) {
  stepNumber += 1;
  process.stdout.write(`\n${bold}${stepNumber}. ${title}${reset}\n`);
}

export const info = (message) => process.stdout.write(`   ${message}\n`);
export const detail = (message) => process.stdout.write(`   ${dim}${message}${reset}\n`);
export const done = (message) => process.stdout.write(`   ${green}ok${reset}  ${message}\n`);
export const warn = (message) => process.stdout.write(`   ${yellow}!${reset}   ${message}\n`);

/** Announces something `--dry-run` would have done. */
export const planned = (message) =>
  process.stdout.write(`   ${blue}dry${reset} ${dim}${message}${reset}\n`);

export function fail(message, hint) {
  process.stdout.write(`\n${red}${bold}Stopped.${reset} ${message}\n`);
  if (hint) process.stdout.write(`\n${hint}\n`);
  process.exit(1);
}

/** A set-off block, for anything the reader has to act on themselves. */
export function callout(lines) {
  process.stdout.write('\n');
  for (const line of lines) process.stdout.write(`   ${line}\n`);
  process.stdout.write('\n');
}

/**
 * One interface for the whole run, read through its async iterator.
 *
 * A fresh interface per question swallows whatever is already buffered on
 * stdin, and `rl.question` drops lines that arrive while no question is
 * pending — both of which break the moment answers are piped in rather than
 * typed. The iterator pauses the stream between reads, so nothing is lost.
 */
let session;
let lines;
let exhausted = false;

function reader() {
  if (!lines) {
    session = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      // Line editing only makes sense at a terminal; on a pipe it emits cursor
      // escapes into the transcript.
      terminal: Boolean(process.stdin.isTTY),
    });
    lines = session[Symbol.asyncIterator]();
  }
  return lines;
}

/** Releases stdin so the process can exit. Call once prompting is finished. */
export function closeInput() {
  session?.close();
  session = undefined;
  lines = undefined;
}

/** True once stdin has run out, so callers can stop asking. */
export const inputExhausted = () => exhausted;

async function ask(question, { hidden = false } = {}) {
  const iterator = reader();
  process.stdout.write(question);
  // Suppressing the echo is the only way to keep a pasted token off the screen
  // and out of the scrollback.
  const echo = session._writeToOutput?.bind(session);
  if (hidden) session._writeToOutput = () => {};

  const { value, done: finished } = await iterator.next();

  if (hidden) {
    session._writeToOutput = echo;
    process.stdout.write('\n');
  }
  if (finished) {
    exhausted = true;
    process.stdout.write('\n');
    return '';
  }
  return value.trim();
}

/**
 * Asks a question, offering `fallback` as the default. Returns the default when
 * the answer is empty, and keeps asking while `validate` returns a message.
 */
export async function prompt(question, { fallback = '', validate } = {}) {
  for (;;) {
    const suffix = fallback ? ` ${dim}[${fallback}]${reset}` : '';
    const answer = (await ask(`   ${question}${suffix}: `)) || fallback;
    if (!answer) {
      if (exhausted) fail(`No answer for "${question}" and stdin has ended.`);
      warn('Required.');
      continue;
    }
    const problem = validate?.(answer);
    if (problem) {
      warn(problem);
      continue;
    }
    return answer;
  }
}

/** Reads a value that must not appear on screen or in the scrollback. */
export const promptSecret = (question) => ask(`   ${question}: `, { hidden: true });

export async function confirm(question, { fallback = true } = {}) {
  const hint = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`   ${question} ${dim}[${hint}]${reset} `)).toLowerCase();
  if (!answer) return fallback;
  return answer.startsWith('y');
}
