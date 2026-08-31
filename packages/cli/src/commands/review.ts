import { formatBytes } from '@liha/shared';
import { flagString, type ParsedArgs } from '../args.js';
import { assertUploadable, collectFiles, totalBytes } from '../files.js';
import { CliError, EXIT, table, type ExitCode, type Reporter } from '../output.js';
import { commentFilter, requireOwnerToken, resolveTarget } from '../context.js';
import { writeProjectLink, forgetPreview, rememberPreview, findCredential } from '../config.js';

export async function updateCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const path = args.positionals[0];
  if (!path) throw new CliError('Usage: liha-preview update <path>', EXIT.usage, 'usage');

  const target = await resolveTarget(args);
  requireOwnerToken(target);
  const files = await collectFiles(path);
  assertUploadable(files);
  reporter.step(
    `Uploading ${files.length} file(s), ${formatBytes(totalBytes(files))} → ${target.slug}`,
  );

  const result = await target.client.addVersion(target.slug, files, flagString(args, 'label'));
  reporter.emit(
    {
      ok: true,
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
        `Published v${result.version.number}`,
        `Share URL   ${result.preview.shareUrl}`,
        `Files       ${result.version.fileCount} (${formatBytes(result.version.byteSize)})`,
      ].join('\n'),
  );
  return EXIT.ok;
}

export async function commentsCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const target = await resolveTarget(args);
  const filter = commentFilter(args);
  const { comments, counts } = await target.client.listComments(target.slug, filter);

  reporter.emit(
    {
      ok: true,
      previewId: target.previewId,
      slug: target.slug,
      status: filter,
      counts,
      comments: comments.map((comment) => ({
        id: comment.id,
        status: comment.status,
        parentId: comment.parentId,
        replyCount: comment.replyCount,
        authorName: comment.authorName,
        body: comment.body,
        versionId: comment.versionId,
        versionNumber: comment.versionNumber,
        outdated: comment.stale,
        createdAt: comment.createdAt,
        resolvedAt: comment.resolvedAt,
        target: {
          description: comment.targetDescription,
          selector: comment.target.element?.selector ?? null,
          tagName: comment.target.element?.tagName ?? null,
          textContent: comment.target.element?.textContent ?? null,
          htmlSnippet: comment.target.element?.htmlSnippet ?? null,
          path: comment.target.path ?? null,
          page: comment.target.page ?? null,
          annotation: comment.target.annotation ?? null,
          viewport: comment.target.viewport ?? null,
        },
      })),
    },
    () => {
      if (comments.length === 0) return `No ${filter === 'all' ? '' : filter} comments.`;
      const rows = [['STATUS', 'VER', 'AUTHOR', 'TARGET', 'COMMENT', 'ID']];
      for (const comment of comments) {
        // Replies are indented under the comment they answer.
        const reply = comment.parentId !== null;
        rows.push([
          reply ? '' : comment.status,
          reply ? '' : `v${comment.versionNumber ?? '?'}${comment.stale ? '*' : ''}`,
          reply ? `  ${comment.authorName}` : comment.authorName,
          reply ? '' : truncate(comment.target.element?.selector ?? comment.targetDescription, 30),
          truncate(`${reply ? '\u21b3 ' : ''}${comment.body.replace(/\s+/g, ' ')}`, 48),
          comment.id,
        ]);
      }
      return `${table(rows)}\n\n${counts.open} open · ${counts.resolved} resolved${
        comments.some((c) => c.stale) ? '\n* left on an older version' : ''
      }`;
    },
  );
  return EXIT.ok;
}

export async function commentCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const commentId = args.positionals[0];
  if (!commentId)
    throw new CliError('Usage: liha-preview comment <commentId>', EXIT.usage, 'usage');
  const target = await resolveTarget(args);
  const { comment } = await target.client.getComment(target.slug, commentId);

  reporter.emit({ ok: true, comment }, () =>
    [
      `${comment.status.toUpperCase()}  ${comment.id}`,
      `Author   ${comment.authorName}`,
      `Version  v${comment.versionNumber ?? '?'}${comment.stale ? ' (outdated)' : ''}`,
      `Target   ${comment.targetDescription}`,
      comment.target.element?.selector ? `Selector ${comment.target.element.selector}` : '',
      comment.target.element?.textContent ? `Text     ${comment.target.element.textContent}` : '',
      '',
      comment.body,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return EXIT.ok;
}

export async function resolveCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const commentIds = args.positionals;
  if (commentIds.length === 0) {
    throw new CliError('Usage: liha-preview resolve <commentId...>', EXIT.usage, 'usage');
  }
  const target = await resolveTarget(args);
  requireOwnerToken(target);

  const resolved: { id: string; status: string; resolvedAt: string | null }[] = [];
  for (const commentId of commentIds) {
    const { comment } = await target.client.resolveComment(
      target.slug,
      commentId,
      flagString(args, 'by') ?? 'cli',
    );
    resolved.push({ id: comment.id, status: comment.status, resolvedAt: comment.resolvedAt });
  }

  reporter.emit({ ok: true, resolved }, () =>
    resolved.map((comment) => `Resolved ${comment.id}`).join('\n'),
  );
  return EXIT.ok;
}

export async function addCommentCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const body = args.positionals.join(' ').trim() || flagString(args, 'body') || '';
  if (!body) throw new CliError('Usage: liha-preview note <text>', EXIT.usage, 'usage');
  const target = await resolveTarget(args);
  const { comment } = await target.client.addComment(target.slug, {
    body,
    authorName: flagString(args, 'author') ?? 'CLI',
  });
  reporter.emit(
    { ok: true, comment: { id: comment.id, status: comment.status } },
    () => `Added comment ${comment.id}`,
  );
  return EXIT.ok;
}

export async function replyCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const [commentId, ...rest] = args.positionals;
  const body = rest.join(' ').trim() || flagString(args, 'body') || '';
  if (!commentId || !body) {
    throw new CliError('Usage: liha-preview reply <commentId> <text>', EXIT.usage, 'usage');
  }
  const target = await resolveTarget(args);
  const { comment } = await target.client.addComment(target.slug, {
    body,
    authorName: flagString(args, 'author') ?? 'AI agent',
    parentId: commentId,
  });
  reporter.emit(
    { ok: true, comment: { id: comment.id, parentId: comment.parentId } },
    () => `Replied in ${commentId} as ${comment.authorName}`,
  );
  return EXIT.ok;
}

export async function infoCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const target = await resolveTarget(args);
  const summary = await target.client.getSummary(target.slug);
  const { preview, currentVersion, counts, versions } = summary;

  reporter.emit(
    {
      ok: true,
      previewId: preview.id,
      slug: preview.slug,
      title: preview.title,
      type: preview.type,
      shareUrl: preview.shareUrl,
      contentUrl: preview.contentUrl,
      passwordProtected: preview.passwordProtected,
      currentVersion: currentVersion
        ? {
            id: currentVersion.id,
            number: currentVersion.number,
            fileCount: currentVersion.fileCount,
            byteSize: currentVersion.byteSize,
            createdAt: currentVersion.createdAt,
          }
        : null,
      versionCount: versions.length,
      counts,
      hasOwnerToken: Boolean(target.ownerToken),
      apiUrl: target.apiUrl,
    },
    () =>
      [
        `Title        ${preview.title}`,
        `Share URL    ${preview.shareUrl}`,
        `Preview ID   ${preview.id}`,
        `Type         ${preview.type}${preview.passwordProtected ? ' · password protected' : ''}`,
        `Version      v${currentVersion?.number ?? '-'} of ${versions.length}`,
        `Comments     ${counts.open} open · ${counts.resolved} resolved`,
        `Owner token  ${target.ownerToken ? 'stored' : 'not available'}`,
      ].join('\n'),
  );
  return EXIT.ok;
}

export async function versionsCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const target = await resolveTarget(args);
  const { versions } = await target.client.listVersions(target.slug);

  reporter.emit(
    {
      ok: true,
      slug: target.slug,
      versions: versions.map((version) => ({
        id: version.id,
        number: version.number,
        label: version.label,
        isCurrent: version.isCurrent,
        fileCount: version.fileCount,
        byteSize: version.byteSize,
        source: version.source,
        createdAt: version.createdAt,
      })),
    },
    () => {
      const rows = [['', 'VERSION', 'FILES', 'SIZE', 'SOURCE', 'CREATED', 'ID']];
      for (const version of versions) {
        rows.push([
          version.isCurrent ? '*' : ' ',
          `v${version.number}`,
          String(version.fileCount),
          formatBytes(version.byteSize),
          version.source,
          new Date(version.createdAt).toLocaleString(),
          version.id,
        ]);
      }
      return table(rows);
    },
  );
  return EXIT.ok;
}

export async function useVersionCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const wanted = args.positionals[0];
  if (!wanted) {
    throw new CliError('Usage: liha-preview use-version <number|versionId>', EXIT.usage, 'usage');
  }
  const target = await resolveTarget(args);
  requireOwnerToken(target);

  const { versions } = await target.client.listVersions(target.slug);
  const match = /^v?\d+$/.test(wanted)
    ? versions.find((version) => version.number === Number.parseInt(wanted.replace('v', ''), 10))
    : versions.find((version) => version.id === wanted);
  if (!match) {
    throw new CliError(
      `No version "${wanted}" on this preview.`,
      EXIT.notFound,
      'version_not_found',
    );
  }

  const result = await target.client.setCurrentVersion(target.slug, match.id);
  reporter.emit(
    {
      ok: true,
      slug: result.preview.slug,
      shareUrl: result.preview.shareUrl,
      currentVersion: { id: result.version.id, number: result.version.number },
    },
    () => `${result.preview.shareUrl} now serves v${result.version.number}`,
  );
  return EXIT.ok;
}

export async function linkCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const idOrSlug = args.positionals[0];
  if (!idOrSlug) {
    throw new CliError(
      'Usage: liha-preview link <previewId|slug> [--token <ownerToken>]',
      EXIT.usage,
      'usage',
    );
  }
  const target = await resolveTarget({
    ...args,
    flags: new Map(args.flags).set('preview', idOrSlug),
  });
  const { preview } = await target.client.getPreview(target.slug);

  const token = flagString(args, 'token') ?? (await findCredential(idOrSlug))?.ownerToken;
  if (token) {
    await rememberPreview({
      previewId: preview.id,
      slug: preview.slug,
      ownerToken: token,
      apiUrl: target.apiUrl,
      title: preview.title,
      updatedAt: new Date().toISOString(),
    });
  }
  const linkPath = await writeProjectLink({
    previewId: preview.id,
    slug: preview.slug,
    apiUrl: target.apiUrl,
    shareUrl: preview.shareUrl,
  });

  reporter.emit(
    {
      ok: true,
      previewId: preview.id,
      slug: preview.slug,
      shareUrl: preview.shareUrl,
      linkFile: linkPath,
      ownerTokenStored: Boolean(token),
    },
    () =>
      `Linked this project to ${preview.shareUrl}\nWrote ${linkPath}${
        token ? '' : '\nNo owner token stored: pass --token to enable updates.'
      }`,
  );
  return EXIT.ok;
}

export async function unlinkCommand(args: ParsedArgs, reporter: Reporter): Promise<ExitCode> {
  const target = await resolveTarget(args).catch(() => null);
  if (target?.previewId && flagString(args, 'forget') !== 'false') {
    await forgetPreview(target.previewId);
  }
  reporter.emit(
    { ok: true, forgot: target?.previewId ?? null },
    () => 'Removed stored credentials.',
  );
  return EXIT.ok;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
