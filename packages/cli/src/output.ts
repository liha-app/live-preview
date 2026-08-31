/**
 * Output discipline for a CLI that agents parse.
 *
 * stdout carries the result and nothing else — in `--json` mode it is exactly
 * one JSON document. Progress, warnings and errors go to stderr, so piping
 * stdout into `jq` never breaks.
 */

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  notFound: 3,
  auth: 4,
  conflict: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT.error,
    readonly code = 'cli_error',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
}

export class Reporter {
  constructor(private readonly options: OutputOptions) {}

  get json(): boolean {
    return this.options.json;
  }

  /** Progress information for humans. Never emitted in `--json` mode. */
  step(message: string): void {
    if (this.options.json || this.options.quiet) return;
    process.stderr.write(`${message}\n`);
  }

  warn(message: string): void {
    if (this.options.quiet) return;
    process.stderr.write(`warning: ${message}\n`);
  }

  /** The command's result. In JSON mode this is the only thing on stdout. */
  emit(data: unknown, humanReadable: () => string): void {
    if (this.options.json) {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    const text = humanReadable();
    if (text) process.stdout.write(`${text}\n`);
  }

  fail(error: CliError): void {
    if (this.options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: false,
            error: { code: error.code, message: error.message, details: error.details ?? null },
          },
          null,
          2,
        )}\n`,
      );
    }
    process.stderr.write(`error: ${error.message}\n`);
  }
}

export function table(rows: string[][]): string {
  if (rows.length === 0) return '';
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, index) => (cell ?? '').padEnd(widths[index]!))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
