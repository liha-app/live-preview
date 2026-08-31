import { CliError, EXIT } from './output.js';

export interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

/**
 * Small POSIX-ish parser: `--flag`, `--flag=value`, `--flag value`, `--no-flag`
 * and `-x` shorthands. Deliberately hand-rolled — the CLI's contract with
 * agents is stable output, and that is easier to guarantee without a
 * dependency's own opinions about help text and error formatting.
 */
export function parseArgs(argv: string[], valueFlags: Set<string>): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith('--');
    const body = isLong ? token.slice(2) : token.slice(1);
    const equals = body.indexOf('=');

    if (equals !== -1) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    if (isLong && body.startsWith('no-')) {
      flags.set(body.slice(3), false);
      continue;
    }
    if (valueFlags.has(body)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new CliError(`Flag --${body} needs a value.`, EXIT.usage, 'usage');
      }
      flags.set(body, next);
      index += 1;
      continue;
    }
    flags.set(body, true);
  }

  return { command: positionals[0] ?? null, positionals: positionals.slice(1), flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(args: ParsedArgs, name: string, fallback = false): boolean {
  const value = args.flags.get(name);
  if (value === undefined) return fallback;
  return value !== false && value !== 'false';
}
