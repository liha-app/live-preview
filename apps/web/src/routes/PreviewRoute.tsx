import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { History, Keyboard, Sparkles, WifiOff } from 'lucide-react';
import type { Comment, CommentFilter, CommentTarget, Preview } from '@liha/shared';
import { describeTarget } from '@liha/shared';
import { registerLihaTools, type LihaWebMcpHost, type RegistrationHandle } from '@liha/webmcp';
import { ApiClientError, api } from '../lib/api.js';
import { captureOwnerTokenFromHash, ownerTokens, reviewerName } from '../lib/storage.js';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts.js';
import { useShortcuts } from '../lib/useShortcuts.js';
import { useT } from '../i18n/index.js';
import { LocaleToggle } from '../components/LocaleToggle.js';
import { useTheme } from '../lib/useTheme.js';
import { postToBridge } from '../lib/bridge-client.js';
import type { UploadSelection } from '../lib/files.js';
import { CommentSidebar, type Thread } from '../components/CommentSidebar.js';
import {
  OwnerSettingsModal,
  PasswordGate,
  ShareModal,
  UploadVersionModal,
} from '../components/Dialogs.js';
import { Dock } from '../components/Dock.js';
import { InlineComposer, type AnchorPoint } from '../components/InlineComposer.js';
import { ShortcutsModal } from '../components/ShortcutsModal.js';
import { AgentPanel } from '../components/AgentPanel.js';
import {
  EMPTY_DRAFT,
  PreviewStage,
  VIEWPORTS,
  type DraftTarget,
  type ViewportId,
} from '../components/PreviewStage.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { TopBar } from '../components/TopBar.js';
import type { Tool } from '../components/AnnotationLayer.js';

interface AgentEvent {
  id: number;
  name: string;
  ok: boolean;
  summary: string;
}

const TOOL_KEYS: Record<string, Tool> = {
  v: 'cursor',
  p: 'pin',
  r: 'rect',
  d: 'freehand',
  a: 'arrow',
};

/** Reads the slug from the path, for deployments that serve `/p/<slug>`. */
export function PreviewRouteFromPath() {
  const { slug } = useParams({ from: '/p/$slug' });
  return <PreviewRoute slug={slug} />;
}

export function PreviewRoute({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const t = useT();

  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('cursor');
  const [viewportId, setViewportId] = useState<ViewportId>('fit');
  const [filter, setFilter] = useState<CommentFilter>('open');
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTarget>(EMPTY_DRAFT);
  const [draftAnchor, setDraftAnchor] = useState<AnchorPoint | null>(null);
  const [draftBody, setDraftBody] = useState(() => readDraft(slug));
  const [authorName, setAuthorName] = useState(() => reviewerName.get());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [pinnedVersionId, setPinnedVersionId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    'share' | 'upload' | 'settings' | 'shortcuts' | 'agent' | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [registration, setRegistration] = useState<RegistrationHandle | null>(null);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    captureOwnerTokenFromHash(slug);
    setOwnerToken(ownerTokens.get(slug));
  }, [slug]);

  useEffect(() => writeDraft(slug, draftBody), [slug, draftBody]);
  useEffect(() => {
    if (authorName.trim()) reviewerName.set(authorName.trim());
  }, [authorName]);

  // ------------------------------------------------------------------ data

  const previewQuery = useQuery({
    queryKey: ['preview', slug],
    queryFn: () => api.getPreview(slug),
    retry: (count, error) => !(error instanceof ApiClientError) && count < 2,
  });
  const preview = previewQuery.data?.preview ?? null;
  const isOwner = previewQuery.data?.isOwner ?? false;

  const versionsQuery = useQuery({
    queryKey: ['versions', slug],
    queryFn: () => api.listVersions(slug),
    enabled: Boolean(preview),
  });
  const commentsQuery = useQuery({
    queryKey: ['comments', slug],
    queryFn: () => api.listComments(slug, 'all'),
    enabled: Boolean(preview),
  });
  const shareQuery = useQuery({
    queryKey: ['share', slug],
    queryFn: () => api.getShareInfo(slug),
    enabled: Boolean(preview),
  });

  const versions = useMemo(() => versionsQuery.data?.versions ?? [], [versionsQuery.data]);
  const allComments = useMemo(() => commentsQuery.data?.comments ?? [], [commentsQuery.data]);
  const counts = commentsQuery.data?.counts ?? { open: 0, resolved: 0, total: 0 };

  const activeVersionId = pinnedVersionId ?? preview?.currentVersionId ?? null;
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['preview', slug] });
    void queryClient.invalidateQueries({ queryKey: ['versions', slug] });
    void queryClient.invalidateQueries({ queryKey: ['comments', slug] });
    void queryClient.invalidateQueries({ queryKey: ['share', slug] });
  }, [queryClient, slug]);

  /** Groups the flat comment list into threads, preserving server order. */
  const threads = useMemo<Thread[]>(() => {
    const byId = new Map<string, Thread>();
    const order: string[] = [];
    for (const comment of allComments) {
      if (comment.parentId) continue;
      byId.set(comment.id, { root: comment, replies: [] });
      order.push(comment.id);
    }
    for (const comment of allComments) {
      if (!comment.parentId) continue;
      byId.get(comment.parentId)?.replies.push(comment);
    }
    return order
      .map((id) => byId.get(id)!)
      .filter((thread) => filter === 'all' || thread.root.status === filter);
  }, [allComments, filter]);

  const stageComments = useMemo(
    () => allComments.filter((c) => !c.parentId && c.versionId === activeVersionId),
    [allComments, activeVersionId],
  );

  // ------------------------------------------------------------- mutations

  const targetOf = (source: DraftTarget): CommentTarget => ({
    annotation: source.annotation,
    element: source.element,
    path: source.path,
    page: source.page,
    viewport: source.viewport,
  });

  const clearComposer = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setDraftAnchor(null);
    setDraftBody('');
    clearDraft(slug);
  }, [slug]);

  const addComment = useMutation({
    mutationFn: (input: { body: string; authorName: string; target: CommentTarget }) =>
      api.addComment(slug, { ...input, versionId: activeVersionId ?? undefined }),
    onSuccess: ({ comment }) => {
      clearComposer();
      setAnnouncement(t('comments.added'));
      setSelectedCommentId(comment.id);
      refresh();
    },
  });

  const addReply = useMutation({
    mutationFn: (input: { body: string; authorName: string; parentId: string }) =>
      api.addComment(slug, input),
    onSuccess: () => {
      setReplyingTo(null);
      setReplyBody('');
      setAnnouncement(t('comments.replyAdded'));
      refresh();
    },
  });

  const resolveComment = useMutation({
    mutationFn: (commentId: string) => api.resolveComment(slug, commentId),
    onSuccess: () => {
      setAnnouncement(t('comments.resolved'));
      refresh();
    },
  });
  const reopenComment = useMutation({
    mutationFn: (commentId: string) => api.reopenComment(slug, commentId),
    onSuccess: refresh,
  });
  const addVersion = useMutation({
    mutationFn: (input: { selection: UploadSelection; label: string }) =>
      api.addVersion(slug, input.selection.parts, input.label || undefined),
    onSuccess: () => {
      setPinnedVersionId(null);
      setDialog(null);
      setDialogError(null);
      refresh();
    },
    onError: (error) => setDialogError(messageOf(error)),
  });
  const setCurrentVersion = useMutation({
    mutationFn: (versionId: string) => api.setCurrentVersion(slug, versionId),
    onSuccess: () => {
      setPinnedVersionId(null);
      refresh();
    },
    onError: (error) => setDialogError(messageOf(error)),
  });
  const updatePreview = useMutation({
    mutationFn: (input: { password?: string | null; title?: string }) =>
      api.updatePreview(slug, input),
    onSuccess: () => {
      setDialogError(null);
      refresh();
    },
    onError: (error) => setDialogError(messageOf(error)),
  });
  const deletePreview = useMutation({
    mutationFn: () => api.deletePreview(slug),
    onSuccess: () => navigate({ to: '/' }),
    onError: (error) => setDialogError(messageOf(error)),
  });
  const authenticate = useMutation({
    mutationFn: (password: string) => api.authenticate(slug, password),
    onSuccess: () => {
      setPasswordError(null);
      refresh();
    },
    onError: (error) => setPasswordError(messageOf(error)),
  });

  const submitComment = useCallback(
    (input: { body: string; authorName: string }) => {
      setAuthorName(input.authorName);
      addComment.mutate({ ...input, target: targetOf(draft) });
    },
    [addComment, draft],
  );

  // --------------------------------------------------------- deep-linking

  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || allComments.length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get('comment');
    if (!wanted) return;
    deepLinked.current = true;
    const found = allComments.find((comment) => comment.id === wanted);
    if (!found) return;
    setFilter('all');
    setSelectedCommentId(found.parentId ?? found.id);
  }, [allComments]);

  const selectComment = useCallback((id: string | null) => {
    setSelectedCommentId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('comment', id);
    else url.searchParams.delete('comment');
    window.history.replaceState(null, '', url);
  }, []);

  /** Ask the bridge to outline the element a comment points at. */
  const highlight = useCallback(
    (id: string | null) => {
      const selector = id
        ? allComments.find((comment) => comment.id === id)?.target.element?.selector
        : undefined;
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Preview content"]');
      if (selector) postToBridge(frame, { type: 'highlight', selector });
    },
    [allComments],
  );

  useEffect(() => highlight(selectedCommentId), [selectedCommentId, highlight]);

  // ---------------------------------------------------------- WebMCP host

  const latest = useRef({
    preview,
    versions,
    allComments,
    isOwner,
    share: shareQuery.data?.share ?? null,
    activeVersion,
    threads,
  });
  latest.current = {
    preview,
    versions,
    allComments,
    isOwner,
    share: shareQuery.data?.share ?? null,
    activeVersion,
    threads,
  };

  const pushAgentEvent = useCallback((event: Omit<AgentEvent, 'id'>) => {
    const id = Date.now() + Math.random();
    setAgentEvents((current) => [...current.slice(-3), { ...event, id }]);
    setTimeout(() => setAgentEvents((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  useEffect(() => {
    const host: LihaWebMcpHost = {
      getPreview: () => latest.current.preview,
      getShareInfo: () => latest.current.share,
      getVersions: () => latest.current.versions,
      getComments: () => latest.current.allComments,
      isOwner: () => latest.current.isOwner,
      addComment: async (input) => {
        const { comment } = await api.addComment(slug, {
          body: input.body,
          authorName: input.authorName ?? 'AI agent',
          target: input.target,
          // A reply joins an existing thread; the API derives its version from
          // the parent, so versionId is only meaningful for a new thread.
          ...(input.parentId
            ? { parentId: input.parentId }
            : { versionId: latest.current.preview?.currentVersionId ?? undefined }),
        });
        refresh();
        return comment;
      },
      resolveComment: async (commentId) => {
        const { comment } = await api.resolveComment(slug, commentId, 'AI agent');
        refresh();
        return comment;
      },
      listArtifactFiles: () => latest.current.preview?.manifest?.files ?? [],

      readArtifactFile: async (path) => {
        const version = latest.current.activeVersion;
        const manifest = latest.current.preview?.manifest;
        const file = manifest?.files.find((entry) => entry.path === path);
        if (!file || !version?.contentUrl) {
          throw new Error(
            `No file "${path}" in this version. Call list_artifact_files for the paths.`,
          );
        }
        if (!/^(text\/|application\/(json|xml|javascript|manifest))/.test(file.contentType)) {
          throw new Error(`"${path}" is ${file.contentType}, which is not readable as text.`);
        }
        // Content is served from the isolated preview origin, which allows
        // reads from this app origin only.
        const base = new URL(version.contentUrl);
        const target = new URL(path, `${base.origin}/`);
        target.search = base.search;

        const response = await fetch(target);
        if (!response.ok) throw new Error(`Could not read "${path}" (HTTP ${response.status}).`);
        const full = await response.text();
        const limit = 40_000;
        return {
          path,
          contentType: file.contentType,
          text: full.slice(0, limit),
          truncated: full.length > limit,
        };
      },

      setViewport: (viewport) => setViewportId(viewport),

      focusComment: (commentId) => {
        const thread = latest.current.threads.find(
          (item) => item.root.id === commentId || item.replies.some((r) => r.id === commentId),
        );
        if (!thread) return false;
        // Show it in whichever filter it lives in, then select and highlight.
        setFilter('all');
        selectComment(thread.root.id);
        return Boolean(thread.root.target.element?.selector);
      },

      createPreviewFromUrl: async (input) => {
        const created = await api.createPreviewFromUrl(input);
        ownerTokens.set(created.preview.slug, created.ownerToken);
        return {
          previewId: created.preview.id,
          slug: created.preview.slug,
          shareUrl: created.preview.shareUrl,
          ownerToken: created.ownerToken,
        };
      },
      onToolCall: (event) => pushAgentEvent(event),
    };
    const handle = registerLihaTools(host);
    setRegistration(handle);
    return () => {
      handle.unregister();
      setRegistration(null);
    };
  }, [slug, refresh, pushAgentEvent, selectComment]);

  // ------------------------------------------------------------ shortcuts

  const moveSelection = useCallback(
    (delta: number) => {
      if (threads.length === 0) return;
      const current = threads.findIndex((thread) => thread.root.id === selectedCommentId);
      const next = current === -1 ? (delta > 0 ? 0 : threads.length - 1) : current + delta;
      const clamped = Math.min(Math.max(next, 0), threads.length - 1);
      selectComment(threads[clamped]!.root.id);
    },
    [threads, selectedCommentId, selectComment],
  );

  const shortcuts = useMemo(
    () => ({
      ...Object.fromEntries(
        Object.entries(TOOL_KEYS).map(([key, value]) => [key, () => setTool(value)]),
      ),
      c: (event: KeyboardEvent) => {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>('.sidebar .composer__input')?.focus();
      },
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      e: () => {
        const thread = threads.find((item) => item.root.id === selectedCommentId);
        if (thread && isOwner && thread.root.status === 'open')
          resolveComment.mutate(thread.root.id);
      },
      t: () => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'),
      '?': () => setDialog('shortcuts'),
      Escape: () => {
        if (dialog) setDialog(null);
        else if (replyingTo) setReplyingTo(null);
        else if (draft.annotation || draft.element) clearComposer();
        else selectComment(null);
      },
      ...Object.fromEntries(
        VIEWPORTS.map((viewport, index) => [String(index + 1), () => setViewportId(viewport.id)]),
      ),
    }),
    [
      moveSelection,
      threads,
      selectedCommentId,
      isOwner,
      resolveComment,
      theme,
      setTheme,
      dialog,
      replyingTo,
      draft,
      clearComposer,
      selectComment,
    ],
  );

  useShortcuts(shortcuts);

  // --------------------------------------------------------------- render

  if (previewQuery.error instanceof ApiClientError && previewQuery.error.needsPassword) {
    return (
      <PasswordGate
        busy={authenticate.isPending}
        error={passwordError}
        onSubmit={(password) => authenticate.mutate(password)}
      />
    );
  }

  if (previewQuery.error instanceof ApiClientError && previewQuery.error.isNetworkError) {
    return (
      <div className="center-pane">
        <div className="stack" style={{ textAlign: 'center', maxWidth: 380 }}>
          <WifiOff size={18} strokeWidth={1.5} style={{ margin: '0 auto' }} aria-hidden="true" />
          <h2 style={{ margin: 0, fontSize: 15 }}>{t('offline.title')}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t('offline.body')}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void previewQuery.refetch()}
            >
              {previewQuery.isFetching && <span className="spinner" aria-hidden="true" />}
              {t('offline.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <div className="center-pane">
        <span className="spinner" aria-label={t('common.loading')} />
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="center-pane">
        <div className="stack" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{t('notFound.title')}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t('notFound.body')}
          </p>
          <a className="btn" href="/">
            {t('notFound.create')}
          </a>
        </div>
      </div>
    );
  }

  const draftLabel =
    draft.element?.selector ??
    (draft.annotation
      ? describeTarget({ annotation: draft.annotation, page: draft.page, path: draft.path })
      : null);
  const showInlineComposer = Boolean(draftAnchor && draftLabel);

  return (
    <div className="app">
      <TopBar
        preview={preview}
        versions={versions}
        activeVersionId={activeVersionId}
        isOwner={isOwner}
        agentActive={registration?.available ?? false}
        onAgentPanel={() => setDialog('agent')}
        onVersionChange={setPinnedVersionId}
        onShare={() => setDialog('share')}
        onUpload={() => {
          setDialogError(null);
          setDialog('upload');
        }}
        onSettings={() => {
          setDialogError(null);
          setDialog('settings');
        }}
      >
        <LocaleToggle />
        <ThemeToggle theme={theme} onChange={setTheme} />
        <button
          type="button"
          className="btn btn--icon btn--quiet"
          onClick={() => setDialog('shortcuts')}
          aria-label={t('topbar.shortcuts')}
          title={`${t('topbar.shortcuts')} (?)`}
        >
          <Keyboard size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </TopBar>

      {activeVersion && !activeVersion.isCurrent && (
        <div className="strip">
          <History size={13} strokeWidth={1.75} aria-hidden="true" />
          {t('version.viewingOld', { number: activeVersion.number })}
          <span className="spacer" />
          <button type="button" className="btn btn--sm" onClick={() => setPinnedVersionId(null)}>
            {t('version.backToCurrent')}
          </button>
        </div>
      )}

      <div className="workspace">
        <main className="stage">
          <PreviewStage
            preview={preview}
            version={activeVersion}
            comments={stageComments}
            tool={tool}
            viewportId={viewportId}
            selectedCommentId={selectedCommentId}
            draft={draft}
            page={pageCount}
            onPageCountChange={setPageCount}
            onSelectComment={selectComment}
            onDraftChange={setDraft}
            onDraftAnchor={setDraftAnchor}
          />
          <Dock
            tool={tool}
            viewportId={viewportId}
            showViewports={preview.type === 'html' || preview.type === 'url'}
            onToolChange={setTool}
            onViewportChange={setViewportId}
          />
        </main>

        <CommentSidebar
          threads={threads}
          counts={counts}
          filter={filter}
          isOwner={isOwner}
          loading={commentsQuery.isLoading}
          selectedId={selectedCommentId}
          authorName={authorName}
          draftLabel={showInlineComposer ? null : draftLabel}
          showComposer={!showInlineComposer}
          draftBody={draftBody}
          submitting={addComment.isPending}
          replyingTo={replyingTo}
          replyBody={replyBody}
          replySubmitting={addReply.isPending}
          onFilterChange={setFilter}
          onSelect={selectComment}
          onHover={highlight}
          onAuthorChange={setAuthorName}
          onDraftChange={setDraftBody}
          onSubmit={submitComment}
          onCancelDraft={clearComposer}
          onStartReply={(id) => {
            setReplyingTo(id);
            setReplyBody('');
          }}
          onCancelReply={() => setReplyingTo(null)}
          onReplyChange={setReplyBody}
          onSubmitReply={(input) => {
            if (!replyingTo) return;
            setAuthorName(input.authorName);
            addReply.mutate({ ...input, parentId: replyingTo });
          }}
          onResolve={(comment) => resolveComment.mutate(comment.id)}
          onReopen={(comment) => reopenComment.mutate(comment.id)}
        />
      </div>

      {showInlineComposer && draftAnchor && (
        <InlineComposer
          anchor={draftAnchor}
          value={draftBody}
          authorName={authorName}
          targetLabel={draftLabel}
          submitting={addComment.isPending}
          onChange={setDraftBody}
          onAuthorChange={setAuthorName}
          onSubmit={submitComment}
          onCancel={clearComposer}
        />
      )}

      {dialog === 'share' && (
        <ShareModal
          preview={preview}
          share={shareQuery.data?.share ?? null}
          ownerToken={ownerToken}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'upload' && (
        <UploadVersionModal
          busy={addVersion.isPending}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(selection, label) => addVersion.mutate({ selection, label })}
        />
      )}
      {dialog === 'settings' && (
        <OwnerSettingsModal
          preview={preview}
          versions={versions}
          busy={updatePreview.isPending || setCurrentVersion.isPending || deletePreview.isPending}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSetPassword={(password) => updatePreview.mutate({ password })}
          onSetCurrentVersion={(versionId) => setCurrentVersion.mutate(versionId)}
          onDelete={() => deletePreview.mutate()}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsModal onClose={() => setDialog(null)} />}
      {dialog === 'agent' && (
        <AgentPanel registration={registration} onClose={() => setDialog(null)} />
      )}

      {(addComment.error || addReply.error) && (
        <div className="toasts">
          <div className="toast toast--error" role="alert">
            {messageOf(addComment.error ?? addReply.error)}
          </div>
        </div>
      )}

      {agentEvents.length > 0 && (
        <div className="toasts">
          {agentEvents.map((event) => (
            <div key={event.id} className="toast">
              <Sparkles size={13} strokeWidth={1.75} className="faint" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="mono">{event.name}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {event.summary}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export type { Preview, Comment };
