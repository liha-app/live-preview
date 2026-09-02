import { formatBytes } from '@liha-cli/shared';
import { flagString, type ParsedArgs } from '../args.js';
import { LihaClient } from '../client.js';
import { rememberPreview, writeProjectLink } from '../config.js';
import { assertUploadable, collectFiles, totalBytes } from '../files.js';
import { CliError, EXIT, type ExitCode, type Reporter } from '../output.js';
import { resolveApiUrl } from '../context.js';

export async function uploadCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const target = args.positionals[0];
  if (!target) {
    throw new CliError('Usage: liha-preview upload <path>', EXIT.usage, 'usage');
  }

  const apiUrl = await resolveApiUrl(args);
  const files = await collectFiles(target);
  assertUploadable(files);
  reporter.step(`Uploading ${files.length} file(s), ${formatBytes(totalBytes(files))} → ${apiUrl}`);

  const client = new LihaClient({ apiUrl });
  const result = await client.createPreview(files, {
    title: flagString(args, 'title'),
    password: flagString(args, 'password'),
    label: flagString(args, 'label'),
  });

  await rememberPreview({
    previewId: result.preview.id,
    slug: result.preview.slug,
    ownerToken: result.ownerToken,
    apiUrl,
    title: result.preview.title,
    updatedAt: new Date().toISOString(),
  });

  let linkPath: string | null = null;
  if (flagString(args, 'link') !== 'false') {
    linkPath = await writeProjectLink({
      previewId: result.preview.id,
      slug: result.preview.slug,
      apiUrl,
      shareUrl: result.preview.shareUrl,
    });
  }

  reporter.emit(
    {
      ok: true,
      previewId: result.preview.id,
      slug: result.preview.slug,
      shareUrl: result.preview.shareUrl,
      ownerUrl: result.ownerUrl,
      ownerToken: result.ownerToken,
      version: { id: result.version.id, number: result.version.number },
      type: result.preview.type,
      fileCount: result.version.fileCount,
      byteSize: result.version.byteSize,
      passwordProtected: result.preview.passwordProtected,
      linkFile: linkPath,
    },
    () =>
      [
        `Share URL   ${result.preview.shareUrl}`,
        `Preview ID  ${result.preview.id}`,
        `Version     v${result.version.number} (${result.version.fileCount} files, ${formatBytes(result.version.byteSize)})`,
        `Owner token ${result.ownerToken}`,
        '',
        'The owner token is stored in your Liha config and is required to publish new versions.',
      ].join('\n'),
  );
  return EXIT.ok;
}
