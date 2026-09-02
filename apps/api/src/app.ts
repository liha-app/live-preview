import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  CommentFilterSchema,
  CommentTargetSchema,
  CreateCommentInputSchema,
  CreateUrlPreviewInputSchema,
  LIMITS,
  PasswordPolicyError,
  PathValidationError,
  SetCurrentVersionInputSchema,
  UpdatePreviewInputSchema,
  UrlValidationError,
  assertPasswordPolicy,
  createWatchToken,
  formatBytes,
  generateId,
  generateOwnerToken,
  generateReviewToken,
  generateSlug,
  hashPassword,
  hashToken,
  serializeTarget,
  verifyPassword,
  verifyWatchToken,
} from '@liha-cli/shared';
import {
  assertNotRateLimited,
  clientKey,
  isOwner,
  requireOwner,
  requireReviewAccess,
} from './auth.js';
import { matchContentHost, matchReviewHost, originWildcard } from './content-origin.js';
import { matchContentPath, resolveViaReferer, serveVersionFile } from './content.js';
import { DEMO_TITLE, demoComments, demoFiles } from './demo.js';
import { isUsableEndpoint, notifyWatchers, pendingFor, vapidKeys, watchedBy } from './notify.js';
import { serviceWorker, watchPage, watchScript } from './notification-site.js';
import {
  APP_HEADER,
  clearCookie,
  readCaller,
  readCookie,
  requireCaller,
  signInWithGoogle,
  startSession,
  SESSION_COOKIE,
} from './accounts.js';
import { extendPreview, touchPreview } from './retention.js';
import {
  exchangeCode,
  googleConfig,
  OAUTH_COOKIE,
  readPending,
  safeReturn,
  startSignIn,
} from './google.js';
import { resolveConfig, type Env, type ResolvedConfig } from './env.js';
import { ApiError, badRequest, notFound, tooLarge } from './errors.js';
import type { Database } from './ports.js';
import { importUrlPreview } from './url-import.js';
import {
  countComments,
  countRateEvents,
  createReviewSession,
  deleteReviewSessions,
  findComment,
  findPreviewById,
  findPreviewBySlug,
  findValidReviewSession,
  findVersion,
  insertComment,
  insertPreview,
  insertVersion,
  listComments,
  activityFor,
  addPushWatch,
  countWatchers,
  deletePushSubscription,
  expiredPreviews,
  deleteSession,
  deleteWatchesFor,
  mergeAccounts,
  previewsFor,
  recordInvolvement,
  setPreviewAccount,
  type AccountRow,
  listVersions,
  removePushWatch,
  upsertPushSubscription,
  totalStoredBytes,
  nextVersionNumber,
  nowIso,
  pruneExpired,
  recordAuthAttempt,
  recordRateEvent,
  setCommentStatus,
  softDeletePreview,
  updatePreviewFields,
  type PreviewRow,
} from './repo.js';
import { ownerUrl, shareUrl, toShareInfo } from './serialize.js';
import { entriesFromFormData, prepareUpload, storeVersionFiles } from './uploads.js';
import {
  commentView,
  commentsView,
  previewView,
  reviewSummaryView,
  versionView,
  versionsView,
  type ViewContext,
} from './views.js';

type Variables = { config: ResolvedConfig; caller: AccountRow | null };
type App = { Bindings: Env; Variables: Variables };

const NO_STORE = { 'cache-control': 'no-store' } as const;

function corsHeaders(origin: string | null, config: ResolvedConfig): Record<string, string> {
  /*
   * Review screens are their own origins, one per preview, so they cannot be
   * listed — they are recognised by the same template that builds them. Only a
   * host this deployment would itself have produced is allowed; a lookalike on
   * a domain shared with other services is not.
   */
  const isReviewScreen =
    origin !== null &&
    matchReviewHost(config.reviewOriginTemplate, new URL(origin).hostname) !== null;

  const allowed =
    origin &&
    (config.allowedOrigins.includes(origin) ||
      config.allowedOrigins.includes('*') ||
      isReviewScreen);
  return {
    // Non-browser clients (CLI, MCP server) send no Origin and are unaffected.
    'access-control-allow-origin': allowed ? origin : config.appOrigin,
    /*
     * The account lives in a cookie on this origin, and a browser discards a
     * credentialed response that does not say so. Only for an origin actually
     * recognised: promising this for the fallback would be promising it for
     * everyone, which a browser rightly refuses alongside a wildcard.
     */
    ...(allowed ? { 'access-control-allow-credentials': 'true' } : {}),
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'content-type,authorization,x-liha-app,x-liha-owner-token,x-liha-review-session',
    'access-control-expose-headers': 'x-liha-review-session',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

/**
 * Runs `work` after the response, when the runtime offers that.
 *
 * `c.executionCtx` throws rather than returning undefined when there is none —
 * which is every test, and any runtime that is not a Worker. There it simply
 * runs inline.
 */
async function after(c: Context<App>, work: Promise<void>): Promise<void> {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

export function createApp() {
  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    const config = resolveConfig(c.env, new URL(c.req.url));
    c.set('config', config);
    /*
     * Only ever read here; an account is minted where one is actually needed,
     * so somebody who only reads a shared link is never given one.
     */
    c.set('caller', (await readCaller(c.env.DB, c.req.raw, config)).account);
    await next();
    for (const [key, value] of Object.entries(
      corsHeaders(c.req.header('origin') ?? null, config),
    )) {
      c.res.headers.set(key, value);
    }
  });

  app.options('*', (c) => c.body(null, 204));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(error.toBody(), error.status as 400, NO_STORE);
    }
    if (error instanceof PathValidationError) {
      return c.json({ error: { code: 'bad_request', message: error.message } }, 400, NO_STORE);
    }
    if (error instanceof PasswordPolicyError) {
      return c.json({ error: { code: 'bad_request', message: error.message } }, 400, NO_STORE);
    }
    if (error instanceof UrlValidationError) {
      return c.json(
        { error: { code: 'bad_request', message: error.message, details: { reason: error.code } } },
        400,
        NO_STORE,
      );
    }
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: {
            code: 'bad_request',
            message: 'Request body failed validation.',
            details: error.issues,
          },
        },
        400,
        NO_STORE,
      );
    }
    /*
     * A body that is not JSON is the caller's mistake, not this server's, and
     * it used to be answered with 500 "Something went wrong" — which tells an
     * agent nothing it can act on. It is the one thing it can fix by itself.
     */
    if (error instanceof SyntaxError) {
      return c.json(
        {
          error: {
            code: 'bad_request',
            message: 'The request body is not valid JSON.',
            details: { reason: error.message },
          },
        },
        400,
        NO_STORE,
      );
    }

    console.error('unhandled error', error);
    return c.json(
      { error: { code: 'internal_error', message: 'Something went wrong.' } },
      500,
      NO_STORE,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'No such route.' } }, 404, NO_STORE),
  );

  // ---------------------------------------------------------------- content

  const serveContent = async (
    c: { env: Env; req: { url: string; header: (name: string) => string | undefined } },
    match: { location: { slug: string; versionNumber: number }; requestedPath: string },
  ) => {
    const url = new URL(c.req.url);
    return serveVersionFile({
      db: c.env.DB,
      bucket: c.env.BUCKET,
      config: resolveConfig(c.env, url),
      location: match.location,
      requestedPath: match.requestedPath,
      token: url.searchParams.get('t'),
      origin: c.req.header('origin') ?? null,
    });
  };

  app.all('/content/:slug/:version/*', async (c) => {
    const match = matchContentPath(new URL(c.req.url).pathname);
    if (!match) throw notFound();
    return serveContent(c, match);
  });

  app.all('/content/:slug/:version', async (c) => {
    const url = new URL(c.req.url);
    const match = matchContentPath(`${url.pathname}/`);
    if (!match) throw notFound();
    return serveContent(c, match);
  });

  // ------------------------------------------------------------------- meta

  app.get('/api/health', (c) =>
    c.json({ ok: true, service: 'liha-live-preview', time: nowIso() }, 200, NO_STORE),
  );

  // --------------------------------------------------------------- previews

  const loadPreview = async (c: { env: Env; req: { param: (k: string) => string } }) => {
    const preview = await findPreviewBySlug(c.env.DB, c.req.param('slug'));
    if (!preview) throw notFound('Preview not found.');
    // Retention counts from use, so opening a review is itself use. Bounded to
    // once an hour, or a busy preview would be a write per page load.
    await touchPreview(c.env.DB, preview);
    return preview;
  };

  /**
   * Attaches whoever is asking to a preview, minting an anonymous account if
   * this is the first thing they have done.
   *
   * Called where somebody acts — making a preview, leaving a comment — never
   * where they only read, so a passer-by following a shared link is not given
   * an identity for looking.
   */
  const attach = async (
    c: Context<App>,
    previewId: string,
    role: 'owner' | 'reviewer',
  ): Promise<AccountRow | null> => {
    const caller = await requireCaller(c.env.DB, c.req.raw, c.get('config'));
    if (!caller.account) return null;
    if (caller.setCookie) c.header('set-cookie', caller.setCookie, { append: true });

    await recordInvolvement(c.env.DB, caller.account.id, previewId, role);
    if (role === 'owner') await setPreviewAccount(c.env.DB, previewId, caller.account.id);
    return caller.account;
  };

  const viewContext = async (
    c: { env: Env; req: { url: string; raw: Request } },
    preview: PreviewRow,
  ): Promise<ViewContext> => ({
    db: c.env.DB,
    config: resolveConfig(c.env, new URL(c.req.url)),
    requestUrl: new URL(c.req.url),
    authorized:
      preview.password_hash === null ||
      (await isOwner(c.req.raw, preview)) ||
      (await hasReviewSession(c.env.DB, c.req.raw, preview)),
  });

  app.post('/api/previews', async (c) => {
    const config = c.get('config');

    // Creating a preview needs no credential, so this is checked before the
    // body is read: an abusive client should not get to stream 30 MB first.
    const rateKey = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'preview', rateKey, LIMITS.commentWindowMs)) >=
      LIMITS.previewsPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many new previews. Try again in a few minutes.');
    }

    assertBodySize(c.req.raw, config);
    const form = await readFormData(c.req.raw);

    const title = readString(form.get('title'));
    const password = readString(form.get('password'));
    const source = readString(form.get('source')) ?? 'api';
    const entries = await entriesFromFormData(form);
    const upload = prepareUpload(entries, { maxVersionBytes: config.maxVersionBytes });
    await assertRoomToStore(c.env.DB, config, upload.totalBytes);

    if (password) assertPasswordPolicy(password);

    const previewId = generateId('preview');
    const versionId = generateId('version');
    const ownerToken = generateOwnerToken();
    const manifest = await storeVersionFiles(c.env.BUCKET, previewId, versionId, upload);
    const timestamp = nowIso();

    const slug = await uniqueSlug(c.env.DB);
    await insertPreview(c.env.DB, {
      id: previewId,
      slug,
      title: (title || defaultTitle(upload.entryPath)).slice(0, LIMITS.maxTitleLength),
      type: upload.kind,
      current_version_id: versionId,
      owner_token_hash: await hashToken(ownerToken),
      password_hash: password ? await hashPassword(password) : null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      expires_at: null,
      account_id: null,
      last_used_at: null,
      is_sample: 0,
    });
    await recordRateEvent(c.env.DB, 'preview', rateKey);
    await insertVersion(c.env.DB, {
      id: versionId,
      preview_id: previewId,
      number: 1,
      label: readString(form.get('label')) ?? null,
      entry_path: upload.entryPath,
      manifest: JSON.stringify(manifest),
      file_count: manifest.files.length,
      byte_size: manifest.totalBytes,
      source,
      created_at: timestamp,
    });

    const preview = (await findPreviewBySlug(c.env.DB, slug))!;
    const ctx: ViewContext = {
      db: c.env.DB,
      config,
      requestUrl: new URL(c.req.url),
      authorized: true,
    };
    const version = (await findVersion(c.env.DB, previewId, versionId))!;

    await attach(c, previewId, 'owner');

    return c.json(
      {
        preview: await previewView(ctx, preview),
        version: await versionView(ctx, preview, version),
        ownerToken,
        ownerUrl: ownerUrl(config, slug, ownerToken),
      },
      201,
      NO_STORE,
    );
  });

  /**
   * Creates a real, fully-functional preview from a bundled sample, seeded with
   * review feedback. It exists so a first-time visitor can see the whole loop —
   * and an agent has something to act on — without building anything first.
   */
  app.post('/api/previews/demo', async (c) => {
    const config = c.get('config');

    // Generous: this is the front door, and a shared office IP should not lock
    // out the next person who wants to look.
    const key = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'demo', key, LIMITS.commentWindowMs)) >=
      LIMITS.demosPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many sample previews. Try again in a few minutes.');
    }

    const previewId = generateId('preview');
    const versionId = generateId('version');
    const ownerToken = generateOwnerToken();
    const slug = await uniqueSlug(c.env.DB);
    const timestamp = nowIso();

    const upload = prepareUpload(
      demoFiles().map((file) => ({ path: file.path, bytes: file.bytes })),
      { maxVersionBytes: config.maxVersionBytes },
    );
    const manifest = await storeVersionFiles(c.env.BUCKET, previewId, versionId, upload);

    await insertPreview(c.env.DB, {
      id: previewId,
      slug,
      title: DEMO_TITLE,
      type: upload.kind,
      current_version_id: versionId,
      owner_token_hash: await hashToken(ownerToken),
      password_hash: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      // A sample is minted per visitor and nobody comes back to one.
      expires_at: new Date(Date.now() + LIMITS.sampleLifetimeMs).toISOString(),
      account_id: null,
      last_used_at: null,
      is_sample: 1,
    });
    await insertVersion(c.env.DB, {
      id: versionId,
      preview_id: previewId,
      number: 1,
      label: 'sample',
      entry_path: upload.entryPath,
      manifest: JSON.stringify(manifest),
      file_count: manifest.files.length,
      byte_size: manifest.totalBytes,
      source: 'demo',
      created_at: timestamp,
    });

    /*
     * Seeded comments are stamped in the recent past, oldest first. Stamping
     * them in the future would sort them after genuinely newer replies, so a
     * real reply would appear above the conversation it answers.
     */
    const seeds = demoComments();
    const seededAt = (index: number) =>
      new Date(Date.now() - (seeds.length - index) * 60_000).toISOString();
    const createdIds: string[] = [];
    for (const [index, seed] of seeds.entries()) {
      const id = generateId('comment');
      const parentId =
        seed.replyToIndex === undefined ? null : (createdIds[seed.replyToIndex] ?? null);
      await insertComment(c.env.DB, {
        id,
        preview_id: previewId,
        version_id: versionId,
        parent_id: parentId,
        author_name: seed.authorName,
        author_kind: 'human',
        body: seed.body,
        target: serializeTarget(
          parentId ? undefined : CommentTargetSchema.parse(seed.target ?? {}),
        ),
        status: 'open',
        created_at: seededAt(index),
        resolved_at: null,
        resolved_by: null,
        // Nobody left these; they are part of the sample.
        account_id: null,
      });
      createdIds.push(id);
    }

    await recordRateEvent(c.env.DB, 'demo', key);

    const preview = (await findPreviewBySlug(c.env.DB, slug))!;
    const ctx: ViewContext = {
      db: c.env.DB,
      config,
      requestUrl: new URL(c.req.url),
      authorized: true,
    };
    const version = (await findVersion(c.env.DB, previewId, versionId))!;
    await attach(c, previewId, 'owner');

    return c.json(
      {
        preview: await previewView(ctx, preview),
        version: await versionView(ctx, preview, version),
        ownerToken,
        ownerUrl: ownerUrl(config, slug, ownerToken),
      },
      201,
      NO_STORE,
    );
  });

  app.post('/api/previews/url', async (c) => {
    const config = c.get('config');

    // The same budget as an upload, and for a stronger reason: this endpoint
    // needs no credential and makes an outbound request on the caller's behalf.
    const rateKey = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'preview', rateKey, LIMITS.commentWindowMs)) >=
      LIMITS.previewsPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many new previews. Try again in a few minutes.');
    }

    const input = CreateUrlPreviewInputSchema.parse(await c.req.json());
    if (input.password) assertPasswordPolicy(input.password);

    const imported = await importUrlPreview(input.url);
    await assertRoomToStore(c.env.DB, config, imported.manifest.totalBytes);

    const previewId = generateId('preview');
    const versionId = generateId('version');
    const ownerToken = generateOwnerToken();

    for (const file of imported.files) {
      await c.env.BUCKET.put(
        `previews/${previewId}/versions/${versionId}/files/${file.path}`,
        file.bytes,
        { httpMetadata: { contentType: file.contentType } },
      );
    }
    await c.env.BUCKET.put(
      `previews/${previewId}/versions/${versionId}/manifest.json`,
      JSON.stringify(imported.manifest),
      { httpMetadata: { contentType: 'application/json' } },
    );

    const timestamp = nowIso();
    const slug = await uniqueSlug(c.env.DB);
    await insertPreview(c.env.DB, {
      id: previewId,
      slug,
      title: (input.title || imported.title).slice(0, LIMITS.maxTitleLength),
      type: 'url',
      current_version_id: versionId,
      owner_token_hash: await hashToken(ownerToken),
      password_hash: input.password ? await hashPassword(input.password) : null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      expires_at: null,
      account_id: null,
      last_used_at: null,
      is_sample: 0,
    });
    await recordRateEvent(c.env.DB, 'preview', rateKey);
    await insertVersion(c.env.DB, {
      id: versionId,
      preview_id: previewId,
      number: 1,
      label: null,
      entry_path: imported.manifest.entryPath,
      manifest: JSON.stringify(imported.manifest),
      file_count: imported.manifest.files.length,
      byte_size: imported.manifest.totalBytes,
      source: 'url',
      created_at: timestamp,
    });

    const preview = (await findPreviewBySlug(c.env.DB, slug))!;
    const ctx: ViewContext = {
      db: c.env.DB,
      config,
      requestUrl: new URL(c.req.url),
      authorized: true,
    };
    const version = (await findVersion(c.env.DB, previewId, versionId))!;
    await attach(c, previewId, 'owner');

    return c.json(
      {
        preview: await previewView(ctx, preview),
        version: await versionView(ctx, preview, version),
        ownerToken,
        ownerUrl: ownerUrl(config, slug, ownerToken),
      },
      201,
      NO_STORE,
    );
  });

  app.get('/api/previews/:slug', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const ctx = await viewContext(c, preview);
    return c.json(
      { preview: await previewView(ctx, preview), isOwner: await isOwner(c.req.raw, preview) },
      200,
      NO_STORE,
    );
  });

  app.patch('/api/previews/:slug', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    const input = UpdatePreviewInputSchema.parse(await c.req.json());

    const fields: Parameters<typeof updatePreviewFields>[2] = {};
    if (input.title !== undefined) fields.title = input.title;
    if (input.password !== undefined) {
      if (input.password === null) {
        fields.password_hash = null;
      } else {
        assertPasswordPolicy(input.password);
        fields.password_hash = await hashPassword(input.password);
      }
      // Changing or clearing the password invalidates every existing reviewer session.
      await deleteReviewSessions(c.env.DB, preview.id);
    }
    await updatePreviewFields(c.env.DB, preview.id, fields);

    const updated = (await findPreviewBySlug(c.env.DB, preview.slug))!;
    const ctx = await viewContext(c, updated);
    return c.json({ preview: await previewView(ctx, updated) }, 200, NO_STORE);
  });

  app.delete('/api/previews/:slug', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    await softDeletePreview(c.env.DB, preview.id);
    await deleteReviewSessions(c.env.DB, preview.id);
    await deleteWatchesFor(c.env.DB, preview.id);
    await deleteStoredObjects(c.env, `previews/${preview.id}/`);
    return c.json({ deleted: true, previewId: preview.id }, 200, NO_STORE);
  });

  // ------------------------------------------------------------ accounts
  //
  // Everything above works without any of this. An account is minted the first
  // time somebody acts, so what it buys is a list and an activity feed; signing
  // in with Google is what carries them to another browser.

  app.get('/api/me', async (c) => {
    const caller = c.get('caller');
    const config = c.get('config');
    return c.json(
      {
        account: caller
          ? {
              id: caller.id,
              signedIn: caller.google_sub !== null,
              email: caller.email,
              displayName: caller.display_name,
            }
          : null,
        googleAvailable: googleConfig(c.env) !== null,
        retentionDays: {
          anonymous: Math.round(LIMITS.anonymousLifetimeMs / 86_400_000),
          signedIn: Math.round(LIMITS.signedInLifetimeMs / 86_400_000),
        },
      },
      200,
      NO_STORE,
    );
  });

  app.get('/api/me/previews', async (c) => {
    const caller = c.get('caller');
    if (!caller) return c.json({ previews: [] }, 200, NO_STORE);

    const config = c.get('config');
    const rows = await previewsFor(c.env.DB, caller.id);
    const previews = await Promise.all(
      rows.map(async (row) => ({
        ...(await previewView(
          {
            db: c.env.DB,
            config,
            requestUrl: new URL(c.req.url),
            authorized: false,
          },
          row,
        )),
        role: row.role === 'owner' ? ('owner' as const) : ('reviewer' as const),
      })),
    );
    return c.json({ previews }, 200, NO_STORE);
  });

  app.get('/api/me/activity', async (c) => {
    const caller = c.get('caller');
    if (!caller) return c.json({ activity: [] }, 200, NO_STORE);

    const config = c.get('config');
    const rows = await activityFor(c.env.DB, caller.id);
    return c.json(
      {
        activity: rows.map((row) => ({
          commentId: row.id,
          slug: row.slug,
          previewTitle: row.preview_title,
          authorName: row.author_name,
          authorKind: row.author_kind === 'agent' ? 'agent' : 'human',
          body: row.body,
          status: row.status,
          createdAt: row.created_at,
          url: `${shareUrl(config, row.slug)}?comment=${row.id}`,
        })),
      },
      200,
      NO_STORE,
    );
  });

  /** Pushes a preview's expiry out. The owner holds the proof already. */
  app.post('/api/previews/:slug/extend', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    const expiresAt = await extendPreview(c.env.DB, preview);
    return c.json({ expiresAt }, 200, NO_STORE);
  });

  // ------------------------------------------------------------ sign-in

  app.get('/api/auth/google/start', async (c) => {
    const google = googleConfig(c.env);
    const config = c.get('config');
    if (!google) {
      throw new ApiError('not_supported', 'This deployment does not offer Google sign-in.');
    }

    const returnTo = safeReturn(c.req.query('return') ?? null, config);
    const { authorizeUrl, cookie } = await startSignIn(google, config, returnTo);
    c.header('set-cookie', cookie, { append: true });
    return c.redirect(authorizeUrl, 302);
  });

  app.get('/api/auth/google/callback', async (c) => {
    const google = googleConfig(c.env);
    const config = c.get('config');
    if (!google) {
      throw new ApiError('not_supported', 'This deployment does not offer Google sign-in.');
    }

    const pending = await readPending(config, readCookie(c.req.raw, OAUTH_COOKIE));
    const state = c.req.query('state');
    const code = c.req.query('code');

    // The state in the URL has to match the one in the cookie: that comparison
    // is the whole CSRF defence of this flow.
    if (!pending || !state || pending.state !== state || !code) {
      return c.redirect(`${config.appOrigin}/?signin=failed`, 302);
    }

    const profile = await exchangeCode(google, config, code, pending.verifier);
    if (!profile) return c.redirect(`${config.appOrigin}/?signin=failed`, 302);

    const current = (await readCaller(c.env.DB, c.req.raw, config)).account;
    const { account, merged } = await signInWithGoogle(c.env.DB, current, profile);
    // Signing in on a second browser must not strand what the first one made.
    if (merged) await mergeAccounts(c.env.DB, merged, account.id);

    c.header('set-cookie', await startSession(c.env.DB, account.id, config), { append: true });
    c.header('set-cookie', `${OAUTH_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly`, {
      append: true,
    });
    return c.redirect(pending.returnTo, 302);
  });

  app.post('/api/auth/signout', async (c) => {
    const token = readCookie(c.req.raw, SESSION_COOKIE);
    if (token) await deleteSession(c.env.DB, await hashToken(token));
    c.header('set-cookie', clearCookie(c.get('config')), { append: true });
    return c.json({ ok: true }, 200, NO_STORE);
  });

  // --------------------------------------------------------------- push
  //
  // Notification permission is per origin, and every preview has its own — so
  // the review screen cannot ask without asking again for the next preview.
  // It sends you to the notification origin instead, carrying a grant that
  // authorises exactly one thing: watching this preview. The owner token stays
  // where it is.

  app.post('/api/previews/:slug/watch-token', async (c) => {
    const preview = await loadPreview(c);
    /*
     * Whoever can read the feedback can ask to be told about it. Being
     * notified is not an owner's privilege — it is the reviewers who are
     * waiting on a reply, and a password-protected preview is still gated
     * because this is the same check that gates reading it.
     */
    await requireReviewAccess(c.env.DB, c.req.raw, preview);

    const key = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'watch', key, LIMITS.commentWindowMs)) >=
      LIMITS.watchesPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many notification setups. Try again shortly.');
    }

    /*
     * One comment wakes every watcher, so the number of watchers is the fan-out
     * of a single request into requests at other people's servers. Anyone with
     * the link can now add one, so it needs a ceiling.
     */
    if ((await countWatchers(c.env.DB, preview.id)) >= LIMITS.watchersPerPreview) {
      throw new ApiError(
        'rate_limited',
        'This preview already has as many people watching it as it can notify.',
      );
    }

    const config = c.get('config');
    if (!config.notificationOrigin || !vapidKeys(c.env)) {
      throw new ApiError('not_supported', 'This deployment does not send notifications.');
    }

    const token = await createWatchToken(config.contentSigningKey, {
      previewId: preview.id,
      // Long enough to allow notifications on the page it opens, short enough
      // that a grant left in a browser history is worth nothing.
      exp: Date.now() + LIMITS.watchTokenLifetimeMs,
    });
    await recordRateEvent(c.env.DB, 'watch', key);
    return c.json(
      { token, notificationOrigin: config.notificationOrigin, title: preview.title },
      200,
      NO_STORE,
    );
  });

  app.post('/api/push/subscribe', async (c) => {
    const config = c.get('config');
    if (!vapidKeys(c.env)) {
      throw new ApiError('not_supported', 'This deployment does not send notifications.');
    }

    const body = (await c.req.json()) as { endpoint?: unknown; watchToken?: unknown };
    if (typeof body.endpoint !== 'string' || typeof body.watchToken !== 'string') {
      throw badRequest('endpoint and watchToken are required.');
    }
    /*
     * This URL is supplied by a client and later fetched by this server, which
     * is the shape of every SSRF. Same check the URL importer uses.
     */
    if (!isUsableEndpoint(body.endpoint)) throw badRequest('That is not a push endpoint.');

    const grant = await verifyWatchToken(config.contentSigningKey, body.watchToken);
    if (!grant) throw new ApiError('unauthorized', 'That notification link has expired.');

    const preview = await findPreviewById(c.env.DB, grant.previewId);
    if (!preview || preview.deleted_at) throw notFound('That preview no longer exists.');

    const subscription = await upsertPushSubscription(c.env.DB, generateId('push'), body.endpoint);
    await addPushWatch(c.env.DB, subscription.id, preview.id);

    return c.json(
      { subscriptionId: subscription.id, previewId: preview.id, title: preview.title },
      200,
      NO_STORE,
    );
  });

  app.post('/api/push/pending', async (c) => {
    const body = (await c.req.json()) as { subscriptionId?: unknown };
    if (typeof body.subscriptionId !== 'string') throw badRequest('subscriptionId is required.');

    // Say the same thing for an unknown id as for one with nothing waiting:
    // this endpoint must not become a way to test whether an id exists.
    const items = await pendingFor(c.env, c.get('config'), body.subscriptionId);
    return c.json({ items }, 200, NO_STORE);
  });

  app.post('/api/push/watches', async (c) => {
    const body = (await c.req.json()) as { subscriptionId?: unknown };
    if (typeof body.subscriptionId !== 'string') throw badRequest('subscriptionId is required.');

    // Same empty answer for an unknown id as for one watching nothing: this
    // must not become a way to test whether an id exists.
    const items = await watchedBy(c.env, c.get('config'), body.subscriptionId);
    return c.json({ items }, 200, NO_STORE);
  });

  app.post('/api/push/unsubscribe', async (c) => {
    const body = (await c.req.json()) as { subscriptionId?: unknown; previewId?: unknown };
    if (typeof body.subscriptionId !== 'string') throw badRequest('subscriptionId is required.');

    if (typeof body.previewId === 'string') {
      await removePushWatch(c.env.DB, body.subscriptionId, body.previewId);
    } else {
      await deletePushSubscription(c.env.DB, body.subscriptionId);
    }
    return c.json({ ok: true }, 200, NO_STORE);
  });

  app.get('/api/previews/:slug/share', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const ctx = await viewContext(c, preview);
    return c.json({ share: toShareInfo(await previewView(ctx, preview)) }, 200, NO_STORE);
  });

  app.get('/api/previews/:slug/summary', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const ctx = await viewContext(c, preview);
    return c.json(await reviewSummaryView(ctx, preview), 200, NO_STORE);
  });

  // --------------------------------------------------------------- versions

  app.get('/api/previews/:slug/versions', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const ctx = await viewContext(c, preview);
    return c.json({ versions: await versionsView(ctx, preview) }, 200, NO_STORE);
  });

  app.post('/api/previews/:slug/versions', async (c) => {
    const config = c.get('config');
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    assertBodySize(c.req.raw, config);

    const form = await readFormData(c.req.raw);
    const entries = await entriesFromFormData(form);
    const upload = prepareUpload(entries, {
      maxVersionBytes: config.maxVersionBytes,
      // A preview keeps its kind across versions: the share URL is stable, so
      // reviewers should not have the renderer change under them.
      declaredKind: preview.type as 'image' | 'html' | 'pdf' | 'url',
    });

    // The per-version cap alone leaves a preview unbounded, since an owner can
    // push versions forever. Checked before anything reaches R2.
    const existingVersions = await listVersions(c.env.DB, preview.id);
    if (existingVersions.length >= LIMITS.maxVersionsPerPreview) {
      throw tooLarge(
        `This preview already has ${LIMITS.maxVersionsPerPreview} versions. ` +
          'Create a new preview for further builds.',
      );
    }
    const storedBytes = existingVersions.reduce((total, row) => total + row.byte_size, 0);
    if (storedBytes + upload.totalBytes > LIMITS.maxPreviewBytes) {
      throw tooLarge(
        `This preview holds ${formatBytes(storedBytes)} across ${existingVersions.length} ` +
          `versions, and the limit is ${formatBytes(LIMITS.maxPreviewBytes)}.`,
      );
    }
    await assertRoomToStore(c.env.DB, config, upload.totalBytes);

    const versionId = generateId('version');
    const manifest = await storeVersionFiles(c.env.BUCKET, preview.id, versionId, upload);
    const number = await nextVersionNumber(c.env.DB, preview.id);

    await insertVersion(c.env.DB, {
      id: versionId,
      preview_id: preview.id,
      number,
      label: readString(form.get('label')) ?? null,
      entry_path: upload.entryPath,
      manifest: JSON.stringify(manifest),
      file_count: manifest.files.length,
      byte_size: manifest.totalBytes,
      source: readString(form.get('source')) ?? 'api',
      created_at: nowIso(),
    });
    await updatePreviewFields(c.env.DB, preview.id, { current_version_id: versionId });

    const updated = (await findPreviewBySlug(c.env.DB, preview.slug))!;
    const ctx = await viewContext(c, updated);
    const version = (await findVersion(c.env.DB, preview.id, versionId))!;
    return c.json(
      {
        preview: await previewView(ctx, updated),
        version: await versionView(ctx, updated, version),
      },
      201,
      NO_STORE,
    );
  });

  /**
   * Fetches the source again as a new version.
   *
   * A preview made from a URL had no way to be brought up to date: the update
   * dialog only took files, so the only way to see the page as it is now was a
   * new preview — and a new share URL, which is the one thing this promises not
   * to change.
   *
   * The URL defaults to the one the current version came from, and may be
   * changed to another page on the way past.
   */
  app.post('/api/previews/:slug/versions/from-url', async (c) => {
    const config = c.get('config');
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);

    if (preview.type !== 'url') {
      throw badRequest('This preview was not made from a URL.');
    }

    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown; label?: unknown };
    const current = preview.current_version_id
      ? await findVersion(c.env.DB, preview.id, preview.current_version_id)
      : null;
    const previousSource = current
      ? ((JSON.parse(current.manifest) as { sourceUrl?: string }).sourceUrl ?? null)
      : null;

    const requested = typeof body.url === 'string' && body.url.trim() !== '' ? body.url : null;
    const target = requested ?? previousSource;
    if (!target) throw badRequest('This preview does not remember where it came from.');

    // An outbound request on the caller's behalf, same as creating one.
    const rateKey = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'preview', rateKey, LIMITS.commentWindowMs)) >=
      LIMITS.previewsPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many imports. Try again in a few minutes.');
    }

    const existingVersions = await listVersions(c.env.DB, preview.id);
    if (existingVersions.length >= LIMITS.maxVersionsPerPreview) {
      throw tooLarge(
        `This preview already has ${LIMITS.maxVersionsPerPreview} versions. ` +
          'Create a new preview for further builds.',
      );
    }

    const imported = await importUrlPreview(target);
    await assertRoomToStore(c.env.DB, config, imported.manifest.totalBytes);

    const versionId = generateId('version');
    for (const file of imported.files) {
      await c.env.BUCKET.put(
        `previews/${preview.id}/versions/${versionId}/files/${file.path}`,
        file.bytes,
        { httpMetadata: { contentType: file.contentType } },
      );
    }
    await c.env.BUCKET.put(
      `previews/${preview.id}/versions/${versionId}/manifest.json`,
      JSON.stringify(imported.manifest),
      { httpMetadata: { contentType: 'application/json' } },
    );

    await insertVersion(c.env.DB, {
      id: versionId,
      preview_id: preview.id,
      number: await nextVersionNumber(c.env.DB, preview.id),
      label: typeof body.label === 'string' && body.label.trim() !== '' ? body.label.trim() : null,
      entry_path: imported.manifest.entryPath,
      manifest: JSON.stringify(imported.manifest),
      file_count: imported.manifest.files.length,
      byte_size: imported.manifest.totalBytes,
      source: 'url',
      created_at: nowIso(),
    });
    await updatePreviewFields(c.env.DB, preview.id, { current_version_id: versionId });
    await recordRateEvent(c.env.DB, 'preview', rateKey);

    const updated = (await findPreviewBySlug(c.env.DB, preview.slug))!;
    const ctx = await viewContext(c, updated);
    const version = (await findVersion(c.env.DB, preview.id, versionId))!;
    return c.json(
      {
        preview: await previewView(ctx, updated),
        version: await versionView(ctx, updated, version),
      },
      201,
      NO_STORE,
    );
  });

  app.post('/api/previews/:slug/current-version', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    const { versionId } = SetCurrentVersionInputSchema.parse(await c.req.json());

    const version = await findVersion(c.env.DB, preview.id, versionId);
    if (!version) throw notFound('That version does not belong to this preview.');
    await updatePreviewFields(c.env.DB, preview.id, { current_version_id: version.id });

    const updated = (await findPreviewBySlug(c.env.DB, preview.slug))!;
    const ctx = await viewContext(c, updated);
    return c.json(
      {
        preview: await previewView(ctx, updated),
        version: await versionView(ctx, updated, version),
      },
      200,
      NO_STORE,
    );
  });

  // --------------------------------------------------------------- comments

  app.get('/api/previews/:slug/comments', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const filter = CommentFilterSchema.parse(c.req.query('status') ?? 'open');
    const versionId = c.req.query('versionId');
    const rows = await listComments(c.env.DB, preview.id, filter, versionId);
    const ctx = await viewContext(c, preview);
    return c.json(
      {
        comments: await commentsView(ctx, preview, rows),
        counts: await countComments(c.env.DB, preview.id),
      },
      200,
      NO_STORE,
    );
  });

  app.post('/api/previews/:slug/comments', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);

    // Anyone holding the share link can post, so this endpoint is rate limited.
    const key = await clientKey(c.req.raw);
    if (
      (await countRateEvents(c.env.DB, 'comment', key, LIMITS.commentWindowMs)) >=
      LIMITS.commentsPerWindow
    ) {
      throw new ApiError('rate_limited', 'Too many comments in a short time. Try again shortly.');
    }

    const input = CreateCommentInputSchema.parse(await c.req.json());

    // A reply joins its parent's thread and inherits the version it was left on,
    // so a conversation cannot straddle two versions of the artifact.
    let parentId: string | null = null;
    let versionId = input.versionId ?? preview.current_version_id;
    let target = input.target;

    if (input.parentId) {
      const parent = await findComment(c.env.DB, preview.id, input.parentId);
      if (!parent) throw notFound('That comment does not belong to this preview.');
      if (parent.parent_id) {
        throw badRequest('Replies cannot be nested. Reply to the top-level comment instead.');
      }
      parentId = parent.id;
      versionId = parent.version_id;
      // The thread root carries the target; replies inherit it implicitly.
      target = undefined;
    }

    if (!versionId) throw badRequest('This preview has no version to comment on.');
    if (!(await findVersion(c.env.DB, preview.id, versionId))) {
      throw notFound('That version does not belong to this preview.');
    }

    const row = {
      id: generateId('comment'),
      preview_id: preview.id,
      version_id: versionId,
      parent_id: parentId,
      author_name: input.authorName,
      author_kind: input.authorKind,
      body: input.body,
      target: serializeTarget(target),
      status: 'open',
      created_at: nowIso(),
      resolved_at: null,
      resolved_by: null,
      account_id: null as string | null,
    };
    const author = await attach(c, preview.id, 'reviewer');
    row.account_id = author?.id ?? null;
    await insertComment(c.env.DB, row);
    await recordRateEvent(c.env.DB, 'comment', key);

    // Somebody is using this preview, so its clock restarts.
    await touchPreview(c.env.DB, preview);

    /*
     * Telling people is not this request's job. It is a handful of round trips
     * to push services that have nothing to do with whether the comment saved,
     * so it runs after the response — and never for the owner's own comment,
     * which would be their phone buzzing at them for typing.
     */
    if (!(await isOwner(c.req.raw, preview))) {
      await after(c, notifyWatchers(c.env, c.get('config'), preview.id));
    }

    const ctx = await viewContext(c, preview);
    return c.json({ comment: await commentView(ctx, preview, row) }, 201, NO_STORE);
  });

  app.get('/api/previews/:slug/comments/:commentId', async (c) => {
    const preview = await loadPreview(c);
    await requireReviewAccess(c.env.DB, c.req.raw, preview);
    const row = await findComment(c.env.DB, preview.id, c.req.param('commentId'));
    if (!row) throw notFound('Comment not found.');
    const ctx = await viewContext(c, preview);
    return c.json({ comment: await commentView(ctx, preview, row) }, 200, NO_STORE);
  });

  app.post('/api/previews/:slug/comments/:commentId/resolve', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    const row = await findComment(c.env.DB, preview.id, c.req.param('commentId'));
    if (!row) throw notFound('Comment not found.');

    const body = await readJsonOptional(c.req.raw);
    const resolvedBy = z
      .object({ resolvedBy: z.string().trim().max(LIMITS.maxAuthorNameLength).optional() })
      .parse(body ?? {}).resolvedBy;

    await setCommentStatus(c.env.DB, row.id, 'resolved', resolvedBy ?? 'owner');
    const updated = (await findComment(c.env.DB, preview.id, row.id))!;
    const ctx = await viewContext(c, preview);
    return c.json({ comment: await commentView(ctx, preview, updated) }, 200, NO_STORE);
  });

  app.post('/api/previews/:slug/comments/:commentId/reopen', async (c) => {
    const preview = await loadPreview(c);
    await requireOwner(c.req.raw, preview);
    const row = await findComment(c.env.DB, preview.id, c.req.param('commentId'));
    if (!row) throw notFound('Comment not found.');
    await setCommentStatus(c.env.DB, row.id, 'open', null);
    const updated = (await findComment(c.env.DB, preview.id, row.id))!;
    const ctx = await viewContext(c, preview);
    return c.json({ comment: await commentView(ctx, preview, updated) }, 200, NO_STORE);
  });

  // ------------------------------------------------------------------- auth

  app.post('/api/previews/:slug/auth', async (c) => {
    const preview = await loadPreview(c);
    if (preview.password_hash === null) {
      return c.json({ reviewSession: null, passwordRequired: false }, 200, NO_STORE);
    }

    const key = await clientKey(c.req.raw);
    await assertNotRateLimited(c.env.DB, preview.id, key);
    const { password } = z.object({ password: z.string().max(512) }).parse(await c.req.json());

    const ok = await verifyPassword(password, preview.password_hash);
    await recordAuthAttempt(c.env.DB, preview.id, key, ok);
    if (!ok) {
      throw new ApiError('invalid_password', 'Incorrect password.');
    }

    await pruneExpired(c.env.DB, LIMITS.passwordAttemptWindowMs);
    const token = generateReviewToken();
    const expiresAt = new Date(Date.now() + LIMITS.reviewSessionTtlMs).toISOString();
    await createReviewSession(c.env.DB, {
      id: generateId('session'),
      preview_id: preview.id,
      token_hash: await hashToken(token),
      expires_at: expiresAt,
    });
    return c.json({ reviewSession: token, expiresAt, passwordRequired: true }, 200, NO_STORE);
  });

  return app;
}

// ------------------------------------------------------------------ helpers

async function hasReviewSession(
  db: Env['DB'],
  request: Request,
  preview: PreviewRow,
): Promise<boolean> {
  const token = request.headers.get('x-liha-review-session');
  if (!token) return false;
  return findValidReviewSession(db, preview.id, await hashToken(token.trim()));
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function defaultTitle(entryPath: string): string {
  const base = entryPath.split('/').pop() ?? 'Preview';
  return base === 'index.html' ? 'Untitled preview' : base;
}

async function uniqueSlug(db: Env['DB']): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = generateSlug();
    if (!(await findPreviewBySlug(db, slug))) return slug;
  }
  throw new ApiError('internal_error', 'Could not allocate a preview slug.');
}

/**
 * Refuses an upload that would take the instance past its storage ceiling.
 *
 * Rate limiting only slows an abuser down. This is the limit that stops, and it
 * is checked before anything is written to R2.
 */
async function assertRoomToStore(
  db: Database,
  config: ResolvedConfig,
  incomingBytes: number,
): Promise<void> {
  if (config.maxTotalBytes === null) return;
  const stored = await totalStoredBytes(db);
  if (stored + incomingBytes > config.maxTotalBytes) {
    throw tooLarge(
      `This instance is full: it holds ${formatBytes(stored)} of its ` +
        `${formatBytes(config.maxTotalBytes)} limit. Delete a preview, or raise MAX_TOTAL_BYTES.`,
    );
  }
}

function assertBodySize(request: Request, config: ResolvedConfig): void {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  // Multipart framing adds a little overhead on top of the payload itself.
  if (Number.isFinite(declared) && declared > config.maxVersionBytes * 1.1 + 1024 * 1024) {
    throw new ApiError('payload_too_large', 'Upload is larger than the per-version limit.');
  }
}

async function readFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ApiError('unsupported_media_type', 'Uploads must be sent as multipart/form-data.');
  }
  try {
    return await request.formData();
  } catch {
    throw badRequest('Could not parse the multipart body.');
  }
}

async function readJsonOptional(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function deleteStoredObjects(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 500 });
    if (listed.objects.length > 0) {
      await env.BUCKET.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/**
 * The review screen, served from the preview's own hostname.
 *
 * The app is one bundle whichever host asks for it, so the Worker tells it
 * which preview it is looking at rather than making it guess from a hostname
 * whose shape is deployment configuration. Any path under the host is the same
 * screen — the preview owns the whole origin, so sub-pages are its to define.
 */
async function serveReviewScreen(
  request: Request,
  env: Env,
  config: ResolvedConfig,
  slug: string,
): Promise<Response> {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(
    // Anything that is not a built file is the app itself.
    new Request(new URL(url.pathname.includes('.') ? url.pathname : '/', url), request),
  );

  const type = asset.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return asset;

  const wildcard = originWildcard(config.contentOriginTemplate);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: blob:${wildcard ? ` ${wildcard}` : ''}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    // The API, not the app: this screen talks to the former and is not served
    // by the latter.
    `connect-src 'self' ${config.apiOrigin}${wildcard ? ` ${wildcard}` : ''}`,
    `frame-src ${wildcard ?? "'none'"}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const html = await asset.text();
  return new Response(
    html.replace(
      '</head>',
      `<meta name="liha:slug" content="${slug}" />` +
        // This host belongs to one preview, so "/" is this same screen. The
        // way out has to be named.
        `<meta name="liha:app" content="${config.appOrigin}" /></head>`,
    ),
    {
      status: asset.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-frame-options': 'DENY',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * Content requests are routed before the API because they may arrive on a
 * different host entirely (`<slug>--<n>.preview.example.com`).
 */
/**
 * Deletes previews whose time is up.
 *
 * Run on a schedule rather than when somebody happens to make a request: an
 * expiry that only fires while the site is busy is not an expiry. Bounded per
 * run, because a sweep that tries to clear a backlog in one go is how a cron
 * job starts timing out; the next run picks up the rest.
 *
 * Storage first, then the row. A row without its bytes is a preview that
 * renders as nothing; bytes without their row are unreachable and get swept
 * again next time.
 */
export async function sweepExpired(env: Env, limit = 100): Promise<number> {
  const due = await expiredPreviews(env.DB, limit);

  for (const preview of due) {
    await deleteStoredObjects(env, `previews/${preview.id}/`);
    await deleteReviewSessions(env.DB, preview.id);
    await deleteWatchesFor(env.DB, preview.id);
    await softDeletePreview(env.DB, preview.id);
  }

  if (due.length > 0) console.log(`[liha] swept ${due.length} expired preview(s)`);
  return due.length;
}

/**
 * The notification origin: one page, its script, and a service worker.
 *
 * Served from the Worker rather than the app bundle because it has to be told
 * the VAPID public key and where the API is — and because a service worker only
 * controls the scope it is served from, so `/sw.js` has to come from here.
 */
function serveNotificationSite(url: URL, env: Env, config: ResolvedConfig): Response | null {
  const keys = vapidKeys(env);
  if (!keys) return new Response('Notifications are not configured.', { status: 404 });

  const pages = { vapidPublicKey: keys.publicKey, apiOrigin: config.apiOrigin };
  const headers = (type: string, extra: Record<string, string> = {}) => ({
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    ...extra,
  });

  if (url.pathname === '/' || url.pathname === '/watch') {
    return new Response(watchPage(), {
      headers: headers('text/html; charset=utf-8', {
        // This origin holds a notification permission, which is not something
        // to guard with `unsafe-inline`.
        'content-security-policy': [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'unsafe-inline'",
          'img-src data:',
          `connect-src ${config.apiOrigin}`,
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
        ].join('; '),
        // Permission cannot be requested from a cross-origin iframe anyway;
        // this says so out loud.
        'x-frame-options': 'DENY',
      }),
    });
  }

  if (url.pathname === '/app.js') {
    return new Response(watchScript(pages), { headers: headers('text/javascript; charset=utf-8') });
  }

  if (url.pathname === '/sw.js') {
    return new Response(serviceWorker(pages), {
      headers: headers('text/javascript; charset=utf-8'),
    });
  }

  return new Response('Not found', { status: 404, headers: headers('text/plain; charset=utf-8') });
}

/**
 * The one thing this needs from a Worker's execution context.
 *
 * Declared rather than imported so the API's types do not drag in the Workers
 * globals — the MCP server typechecks against these same sources.
 */
export interface DeferredWork {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleRequest(
  request: Request,
  env: Env,
  executionCtx?: DeferredWork,
): Promise<Response> {
  const url = new URL(request.url);
  const config = resolveConfig(env, url);

  if (config.notificationOrigin && url.origin === config.notificationOrigin) {
    const response = serveNotificationSite(url, env, config);
    if (response) return response;
  }

  const reviewSlug = matchReviewHost(config.reviewOriginTemplate, url.hostname);
  if (reviewSlug && !url.pathname.startsWith('/api/')) {
    return serveReviewScreen(request, env, config, reviewSlug);
  }

  const hostMatch = matchContentHost(config, url);
  if (hostMatch) {
    try {
      return await serveVersionFile({
        db: env.DB,
        bucket: env.BUCKET,
        config,
        location: hostMatch,
        requestedPath: url.pathname,
        token: url.searchParams.get('t'),
        origin: request?.headers.get('origin') ?? null,
      });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(error instanceof ApiError ? error.message : 'Error', {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  }

  const app = getApp();
  const response = await app.fetch(request, env, executionCtx as never);
  if (response.status === 404 && !url.pathname.startsWith('/api/')) {
    const viaReferer = resolveViaReferer(url.pathname, request.headers.get('referer'));
    if (viaReferer) {
      try {
        return await serveVersionFile({
          db: env.DB,
          bucket: env.BUCKET,
          config,
          location: viaReferer.location,
          requestedPath: viaReferer.requestedPath,
          token: url.searchParams.get('t'),
          origin: request?.headers.get('origin') ?? null,
        });
      } catch {
        return response;
      }
    }
  }
  return response;
}

let cachedApp: ReturnType<typeof createApp> | null = null;
function getApp() {
  cachedApp ??= createApp();
  return cachedApp;
}
