import type { CommentFilter } from '@liha-cli/shared';
import { flagBool, flagString, type ParsedArgs } from './args.js';
import { LihaClient } from './client.js';
import {
  DEFAULT_API_URL,
  findCredential,
  readGlobalConfig,
  readProjectLink,
  type PreviewCredential,
  type ProjectLink,
} from './config.js';
import { CliError, EXIT, Reporter } from './output.js';

export interface CommandContext {
  args: ParsedArgs;
  reporter: Reporter;
  apiUrl: string;
}

export async function resolveApiUrl(args: ParsedArgs): Promise<string> {
  const explicit = flagString(args, 'api') ?? process.env.LIHA_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const link = await readProjectLink();
  if (link?.apiUrl) return link.apiUrl.replace(/\/$/, '');
  const config = await readGlobalConfig();
  return (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
}

export interface ResolvedTarget {
  slug: string;
  previewId: string | null;
  ownerToken: string | undefined;
  apiUrl: string;
  client: LihaClient;
  link: ProjectLink | null;
  credential: PreviewCredential | null;
}

/**
 * Works out which preview a command applies to, in priority order:
 * `--preview`, then the project's `.liha.json`, then a single remembered
 * preview. Owner tokens come from `--token`, `LIHA_OWNER_TOKEN`, or the
 * credential store — never from the project file.
 */
export async function resolveTarget(args: ParsedArgs): Promise<ResolvedTarget> {
  const apiUrl = await resolveApiUrl(args);
  const link = await readProjectLink();
  const explicit = flagString(args, 'preview') ?? process.env.LIHA_PREVIEW;

  let slug: string | null = null;
  let previewId: string | null = null;
  let credential: PreviewCredential | null = null;

  if (explicit) {
    credential = await findCredential(explicit);
    slug = credential?.slug ?? explicit;
    previewId = credential?.previewId ?? (explicit.startsWith('pv_') ? explicit : null);
  } else if (link) {
    credential = await findCredential(link.previewId);
    slug = link.slug;
    previewId = link.previewId;
  } else {
    const config = await readGlobalConfig();
    const entries = Object.values(config.previews);
    if (entries.length === 1) {
      credential = entries[0]!;
      slug = credential.slug;
      previewId = credential.previewId;
    }
  }

  if (!slug) {
    throw new CliError(
      'No preview selected. Run this inside a linked project, or pass --preview <id-or-slug>.',
      EXIT.usage,
      'no_preview',
    );
  }

  const ownerToken =
    flagString(args, 'token') ?? process.env.LIHA_OWNER_TOKEN ?? credential?.ownerToken;

  return {
    slug,
    previewId,
    ownerToken,
    apiUrl,
    link,
    credential,
    client: new LihaClient({ apiUrl, ownerToken }),
  };
}

export function requireOwnerToken(target: ResolvedTarget): string {
  if (!target.ownerToken) {
    throw new CliError(
      `No owner token for preview ${target.slug}. Pass --token, set LIHA_OWNER_TOKEN, ` +
        'or run "liha-preview link" to store it.',
      EXIT.auth,
      'missing_owner_token',
    );
  }
  return target.ownerToken;
}

export function commentFilter(args: ParsedArgs): CommentFilter {
  if (flagBool(args, 'all')) return 'all';
  const status = flagString(args, 'status');
  if (status === 'open' || status === 'resolved' || status === 'all') return status;
  if (status !== undefined) {
    throw new CliError('--status must be open, resolved or all.', EXIT.usage, 'usage');
  }
  return 'open';
}
