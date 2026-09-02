import { flagBool, flagString, parseArgs } from './args.js';
import { CliError, EXIT, Reporter, type ExitCode } from './output.js';
import { HELP } from './help.js';
import { uploadCommand } from './commands/upload.js';
import { deployCommand } from './commands/deploy.js';
import {
  addCommentCommand,
  commentCommand,
  commentsCommand,
  infoCommand,
  linkCommand,
  replyCommand,
  resolveCommand,
  unlinkCommand,
  updateCommand,
  useVersionCommand,
  versionsCommand,
} from './commands/review.js';
import { resolveTarget } from './context.js';

/** Flags that consume the next argv entry when written as `--flag value`. */
const VALUE_FLAGS = new Set([
  'api',
  'preview',
  'token',
  'title',
  'password',
  'label',
  'status',
  'output',
  'build-command',
  'by',
  'author',
  'body',
  'root',
]);

export const VERSION = '0.1.0';

export async function run(argv: string[]): Promise<ExitCode> {
  let reporter = new Reporter({ json: false, quiet: false });
  try {
    const args = parseArgs(argv, VALUE_FLAGS);
    reporter = new Reporter({
      json: flagBool(args, 'json'),
      quiet: flagBool(args, 'quiet'),
    });

    if (flagBool(args, 'version') || args.command === 'version') {
      reporter.emit({ ok: true, version: VERSION }, () => VERSION);
      return EXIT.ok;
    }
    if (!args.command || flagBool(args, 'help') || args.command === 'help') {
      process.stdout.write(HELP);
      return args.command ? EXIT.ok : EXIT.usage;
    }

    switch (args.command) {
      case 'upload':
        return await uploadCommand(args, reporter);
      case 'deploy':
        return await deployCommand(args, reporter);
      case 'update':
        return await updateCommand(args, reporter);
      case 'info':
        return await infoCommand(args, reporter);
      case 'comments':
        return await commentsCommand(args, reporter);
      case 'comment':
        return await commentCommand(args, reporter);
      case 'note':
        return await addCommentCommand(args, reporter);
      case 'reply':
        return await replyCommand(args, reporter);
      case 'resolve':
        return await resolveCommand(args, reporter);
      case 'versions':
        return await versionsCommand(args, reporter);
      case 'use-version':
        return await useVersionCommand(args, reporter);
      case 'link':
        return await linkCommand(args, reporter);
      case 'unlink':
        return await unlinkCommand(args, reporter);
      case 'open': {
        const target = await resolveTarget(args);
        const { preview } = await target.client.getPreview(target.slug);
        reporter.emit({ ok: true, shareUrl: preview.shareUrl }, () => preview.shareUrl);
        return EXIT.ok;
      }
      case 'mcp': {
        // Imported lazily so the MCP SDK is not loaded for ordinary commands.
        const { startMcpServer } = await import('@liha-cli/mcp');
        await startMcpServer({
          apiUrl: flagString(args, 'api') ?? process.env.LIHA_API_URL,
          projectRoot: flagString(args, 'root') ?? process.cwd(),
        });
        return EXIT.ok;
      }
      default:
        throw new CliError(
          `Unknown command "${args.command}". Run "liha-preview --help".`,
          EXIT.usage,
          'unknown_command',
        );
    }
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(
            error instanceof Error ? error.message : String(error),
            EXIT.error,
            'unexpected_error',
          );
    reporter.fail(cliError);
    return cliError.exitCode;
  }
}
