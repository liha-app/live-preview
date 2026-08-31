import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Files, FolderOpen, Link2, Play, Sparkles } from 'lucide-react';
import type { CreatePreviewResult } from '@liha/shared';
import { formatBytes } from '@liha/shared';
import { api } from '../lib/api.js';
import { ownerTokens } from '../lib/storage.js';
import { useTheme } from '../lib/useTheme.js';
import { filesFromDataTransfer, pickFiles, type UploadSelection } from '../lib/files.js';
import { CopyField } from '../components/Dialogs.js';
import { LocaleToggle } from '../components/LocaleToggle.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { useT } from '../i18n/index.js';
import { registerLihaTools, type RegistrationHandle } from '@liha/webmcp';
import { AgentPanel } from '../components/AgentPanel.js';

function PageControls({ onAgentPanel }: { onAgentPanel?(): void }) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  return (
    <div className="page__controls">
      {onAgentPanel && (
        <button
          type="button"
          className="btn btn--icon btn--quiet"
          onClick={onAgentPanel}
          aria-label={t('agent.open')}
          title={t('agent.open')}
        >
          <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <LocaleToggle />
      <ThemeToggle theme={theme} onChange={setTheme} />
    </div>
  );
}

export function HomeRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [registration, setRegistration] = useState<RegistrationHandle | null>(null);
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<CreatePreviewResult | null>(null);
  const [showAgent, setShowAgent] = useState(false);

  const remember = (created: CreatePreviewResult) => {
    ownerTokens.set(created.preview.slug, created.ownerToken);
    setResult(created);
  };

  const upload = useMutation({
    mutationFn: () =>
      api.createPreview(selection!.parts, {
        title: title || undefined,
        password: password || undefined,
      }),
    onSuccess: remember,
  });

  const importUrl = useMutation({
    mutationFn: () =>
      api.createPreviewFromUrl({
        url,
        title: title || undefined,
        password: password || undefined,
      }),
    onSuccess: remember,
  });

  // The sample opens straight into the review UI: the point is to land someone
  // in a working review, not to show them another form.
  const demo = useMutation({
    mutationFn: () => api.createDemoPreview(),
    onSuccess: (created) => {
      ownerTokens.set(created.preview.slug, created.ownerToken);
      void navigate({ to: '/p/$slug', params: { slug: created.preview.slug } });
    },
  });

  /*
   * The home page publishes its own, smaller tool set. Without this the one
   * tool for *creating* a preview would only be offered to an agent already
   * looking at one.
   */
  useEffect(() => {
    const handle = registerLihaTools({
      getPreview: () => null,
      getShareInfo: () => null,
      getVersions: () => [],
      getComments: () => [],
      isOwner: () => false,
      addComment: () => Promise.reject(new Error('Open a preview first.')),
      resolveComment: () => Promise.reject(new Error('Open a preview first.')),
      listArtifactFiles: () => [],
      readArtifactFile: () => Promise.reject(new Error('Open a preview first.')),
      setViewport: () => {},
      focusComment: () => false,
      createPreviewFromUrl: async (input) => {
        const created = await api.createPreviewFromUrl(input);
        ownerTokens.set(created.preview.slug, created.ownerToken);
        void navigate({ to: '/p/$slug', params: { slug: created.preview.slug } });
        return {
          previewId: created.preview.id,
          slug: created.preview.slug,
          shareUrl: created.preview.shareUrl,
          ownerToken: created.ownerToken,
        };
      },
    });
    setRegistration(handle);
    return () => {
      handle.unregister();
      setRegistration(null);
    };
  }, [navigate]);

  const busy = upload.isPending || importUrl.isPending || demo.isPending;
  const error = upload.error ?? importUrl.error ?? demo.error;

  if (result) return <CreatedPanel result={result} onReset={() => setResult(null)} />;

  const agentPanel = showAgent ? (
    <AgentPanel registration={registration} onClose={() => setShowAgent(false)} />
  ) : null;

  return (
    <div className="page">
      {agentPanel}
      <PageControls onAgentPanel={() => setShowAgent(true)} />
      <h1>{t('app.name')} Live Preview</h1>
      <p className="lede">{t('app.tagline')}</p>

      <section className="try">
        <div className="try__text">
          <strong>{t('home.demoHeading')}</strong>
          <p className="muted">{t('home.demoBody')}</p>
        </div>
        <button
          type="button"
          className="btn btn--primary try__cta"
          disabled={busy}
          onClick={() => demo.mutate()}
        >
          {demo.isPending ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Play size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('home.demoCta')}
        </button>
      </section>

      <div
        className="dropzone"
        data-active={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (event) => {
          event.preventDefault();
          setDragging(false);
          setSelection(await filesFromDataTransfer(event.dataTransfer));
        }}
      >
        {selection ? (
          <div>
            <strong>{t.plural('home.ready', selection.parts.length)}</strong>
            <div className="faint">{formatBytes(selection.totalBytes)}</div>
            <div className="faint mono" style={{ marginTop: 6 }}>
              {selection.parts
                .slice(0, 4)
                .map((part) => part.path)
                .join('  ·  ')}
              {selection.parts.length > 4 ? ` … +${selection.parts.length - 4}` : ''}
            </div>
          </div>
        ) : (
          <>
            <strong>{t('home.dropTitle')}</strong>
            <div className="dropzone__hint">{t('home.dropHint')}</div>
          </>
        )}
        <div className="dropzone__actions">
          <button
            type="button"
            className="btn"
            onClick={async () => setSelection(await pickFiles({ directory: false }))}
          >
            <Files size={14} strokeWidth={1.75} aria-hidden="true" />
            {t('upload.files')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => setSelection(await pickFiles({ directory: true }))}
          >
            <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
            {t('upload.folder')}
          </button>
          {selection && (
            <button type="button" className="btn btn--quiet" onClick={() => setSelection(null)}>
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">{t('home.title')}</span>
          <input
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('home.titlePlaceholder')}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">{t('home.password')}</span>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('home.passwordPlaceholder')}
          />
        </label>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!selection || busy}
          onClick={() => upload.mutate()}
        >
          {upload.isPending && <span className="spinner" aria-hidden="true" />}
          {t('home.create')}
        </button>
      </div>

      <h2>{t('home.urlHeading')}</h2>
      <div className="row">
        <input
          className="field"
          placeholder={t('home.urlPlaceholder')}
          aria-label={t('home.urlHeading')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={!url || busy}
          onClick={() => importUrl.mutate()}
        >
          {importUrl.isPending ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {t('home.import')}
        </button>
      </div>
      <p className="faint" style={{ marginTop: 6 }}>
        {t('home.urlHint')}
      </p>

      {error && (
        <div className="notice notice--error" style={{ marginTop: 14 }}>
          {messageOf(error)}
        </div>
      )}

      <h2>{t('home.terminalHeading')}</h2>
      <div className="card">
        <pre className="snippet">
          {`npx @liha/live-preview deploy .          # build, publish, print the share URL
npx @liha/live-preview comments --json   # what reviewers asked for
npx @liha/live-preview update ./dist     # same URL, new version`}
        </pre>
      </div>
    </div>
  );
}

function CreatedPanel({ result, onReset }: { result: CreatePreviewResult; onReset(): void }) {
  const t = useT();

  return (
    <div className="page">
      <PageControls />
      <h1>{t('created.title')}</h1>
      <p className="lede">{t('created.body')}</p>
      <div className="card stack">
        <CopyField label={t('share.url')} value={result.preview.shareUrl} />
        <CopyField label={t('created.ownerLink')} value={result.ownerUrl} />
        <CopyField label={t('share.ownerToken')} value={result.ownerToken} />
        <CopyField label={t('share.previewId')} value={result.preview.id} />
        <p className="faint" style={{ margin: 0 }}>
          {t('created.ownerNote')}
        </p>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <Link className="btn btn--primary" to="/p/$slug" params={{ slug: result.preview.slug }}>
          {t('created.open')}
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <button type="button" className="btn" onClick={onReset}>
          {t('created.another')}
        </button>
      </div>
      <h2>{t('created.agentHeading')}</h2>
      <div className="card">
        <pre className="snippet">
          {`liha-preview link ${result.preview.id} --token ${result.ownerToken.slice(0, 16)}…
liha-preview mcp        # expose this review to a local MCP client`}
        </pre>
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
