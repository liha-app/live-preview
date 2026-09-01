import { relative } from 'node:path';
import { formatBytes } from '@liha/shared';
import { flagBool, flagString, type ParsedArgs } from '../args.js';
import { LihaClient } from '../client.js';
import { rememberPreview, readProjectLink, writeProjectLink } from '../config.js';
import { assertUploadable, collectFiles, totalBytes } from '../files.js';
import { CliError, EXIT, type ExitCode, type Reporter } from '../output.js';
import { resolveApiUrl, resolveTarget } from '../context.js';
import {
  buildCommandFor,
  detectOutputDir,
  inspectProject,
  parseCommandLine,
  runBuild,
} from '../project.js';

/**
 * The one-command path: work out how this project builds, build it, find the
 * output, and publish it — creating the preview on first run and adding a
 * version to the same share URL every time after.
 */
/**
 * Warns before a long silence.
 *
 * The upload is one request, so there is nothing to report while it runs — and
 * the server writes about six files a second, so a large site is minutes of a
 * cursor not moving. Saying so beforehand is the difference between waiting
 * and wondering whether it hung.
 */
function slowUploadNote(fileCount: number): string | null {
  const seconds = Math.round(fileCount / 6);
  if (seconds < 20) return null;
  return `That is a large upload; expect around ${
    seconds < 90 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`
  }.`;
}

export async function deployCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const projectDir = args.positionals[0] ?? '.';
  const project = await inspectProject(projectDir);
  const skipBuild = flagBool(args, 'skip-build');

  const explicitBuild = flagString(args, 'build-command');
  if (!skipBuild && (explicitBuild || project.buildScript)) {
    const [command, commandArgs] = explicitBuild
      ? parseCommandLine(explicitBuild)
      : buildCommandFor(project.packageManager ?? 'npm');
    reporter.step(`Building with ${command} ${commandArgs.join(' ')}…`);
    await runBuild(command, commandArgs, project.root, (chunk) => {
      if (!reporter.json) process.stderr.write(chunk);
    });
  } else if (!skipBuild) {
    reporter.step('No build script found; publishing the directory as-is.');
  }

  const explicitOutput = flagString(args, 'output');
  const outputDir = explicitOutput
    ? `${project.root}/${explicitOutput}`.replace(/\/+/g, '/')
    : (detectOutputDir(project.root) ?? project.root);

  if (!explicitOutput && outputDir === project.root && project.buildScript) {
    throw new CliError(
      'Could not find the build output. Pass --output <dir> to say where it lands.',
      EXIT.usage,
      'output_not_found',
    );
  }
  reporter.step(`Publishing ${relative(process.cwd(), outputDir) || '.'}`);

  const files = await collectFiles(outputDir);
  assertUploadable(files);

  const apiUrl = await resolveApiUrl(args);
  const link = await readProjectLink(project.root);
  const isUpdate = Boolean(link) || Boolean(flagString(args, 'preview'));

  if (isUpdate) {
    const target = await resolveTarget(args);
    if (!target.ownerToken) {
      throw new CliError(
        `This project is linked to ${target.slug} but no owner token is stored for it. ` +
          'Pass --token or set LIHA_OWNER_TOKEN.',
        EXIT.auth,
        'missing_owner_token',
      );
    }
    reporter.step(
      `Updating ${target.slug} with ${files.length} file(s), ${formatBytes(totalBytes(files))}`,
    );
    const updateNote = slowUploadNote(files.length);
    if (updateNote) reporter.step(updateNote);
    const result = await target.client.addVersion(target.slug, files, flagString(args, 'label'));
    reporter.emit(
      {
        ok: true,
        action: 'updated',
        previewId: result.preview.id,
        slug: result.preview.slug,
        shareUrl: result.preview.shareUrl,
        version: { id: result.version.id, number: result.version.number },
        fileCount: result.version.fileCount,
        byteSize: result.version.byteSize,
        openCommentCount: result.preview.openCommentCount,
      },
      () =>
        [
          `Published v${result.version.number} to the same URL`,
          `Share URL   ${result.preview.shareUrl}`,
          `Files       ${result.version.fileCount} (${formatBytes(result.version.byteSize)})`,
          result.preview.openCommentCount > 0
            ? `Open        ${result.preview.openCommentCount} comment(s) still open`
            : 'Open        no open comments',
        ].join('\n'),
    );
    return EXIT.ok;
  }

  reporter.step(
    `Creating a preview from ${files.length} file(s), ${formatBytes(totalBytes(files))}`,
  );
  const createNote = slowUploadNote(files.length);
  if (createNote) reporter.step(createNote);
  const client = new LihaClient({ apiUrl });
  const created = await client.createPreview(files, {
    title: flagString(args, 'title') ?? project.name ?? undefined,
    password: flagString(args, 'password'),
    label: flagString(args, 'label'),
  });

  await rememberPreview({
    previewId: created.preview.id,
    slug: created.preview.slug,
    ownerToken: created.ownerToken,
    apiUrl,
    title: created.preview.title,
    updatedAt: new Date().toISOString(),
  });
  const linkPath = await writeProjectLink(
    {
      previewId: created.preview.id,
      slug: created.preview.slug,
      apiUrl,
      shareUrl: created.preview.shareUrl,
    },
    project.root,
  );

  reporter.emit(
    {
      ok: true,
      action: 'created',
      previewId: created.preview.id,
      slug: created.preview.slug,
      shareUrl: created.preview.shareUrl,
      ownerUrl: created.ownerUrl,
      ownerToken: created.ownerToken,
      version: { id: created.version.id, number: created.version.number },
      fileCount: created.version.fileCount,
      byteSize: created.version.byteSize,
      linkFile: linkPath,
    },
    () =>
      [
        `Share URL   ${created.preview.shareUrl}`,
        `Preview ID  ${created.preview.id}`,
        `Version     v${created.version.number} (${created.version.fileCount} files, ${formatBytes(created.version.byteSize)})`,
        `Linked      ${relative(process.cwd(), linkPath) || linkPath}`,
        '',
        'Run "liha-preview deploy ." again to publish a new version to the same URL.',
      ].join('\n'),
  );
  return EXIT.ok;
}
