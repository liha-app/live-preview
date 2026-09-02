import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { CreatePreviewResult } from '@liha/shared';
import { formatBytes } from '@liha/shared';
import { api } from '../lib/api.js';
import { ownerTokens, seenIntro } from '../lib/storage.js';
import { useTheme } from '../lib/useTheme.js';
import { filesFromDataTransfer, pickFiles, type UploadSelection } from '../lib/files.js';
import { CopyField, Modal } from '../components/Dialogs.js';
import { LocaleToggle } from '../components/LocaleToggle.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { PaperDecor } from '../components/PaperDecor.js';
import { Onboarding } from '../components/Onboarding.js';
import { useT } from '../i18n/index.js';
import { registerLihaTools, type RegistrationHandle } from '@liha/webmcp';
import { AgentPanel } from '../components/AgentPanel.js';

/** What the create sheet is about to make. */
type Pending = 'files' | 'url';

/**
 * Opens a preview that was just created, as its owner.
 *
 * Always a full navigation to the owner link, never a route change. A preview
 * lives on its own origin when the deployment gives it one, and the token that
 * makes you its owner rides in the fragment — `localStorage` does not cross an
 * origin, so a client-side hop to `/p/<slug>` would land you on the landing
 * page's copy of the app, looking at a preview you no longer own.
 */
function openAsOwner(created: CreatePreviewResult): void {
  window.location.href = created.ownerUrl;
}

function PageChrome({ onAgentPanel }: { onAgentPanel?(): void }) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  return (
    <>
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
    </>
  );
}

export function HomeRoute() {
  // Only to decide whether the door to it is worth showing.
  const mine = useQuery({ queryKey: ['me', 'previews'], queryFn: () => api.listMyPreviews() });
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const [registration, setRegistration] = useState<RegistrationHandle | null>(null);
  const [mode, setMode] = useState<'drop' | 'url' | 'cli'>('drop');
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<CreatePreviewResult | null>(null);
  const [showAgent, setShowAgent] = useState(false);
  const [intro, setIntro] = useState(false);

  // Once, on a first visit. After that it lives behind "how it works".
  useEffect(() => {
    if (!seenIntro.get()) {
      seenIntro.set();
      setIntro(true);
    }
  }, []);

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
    onSuccess: (created) => {
      setPending(null);
      remember(created);
    },
  });

  const importUrl = useMutation({
    mutationFn: () =>
      api.createPreviewFromUrl({
        url,
        title: title || undefined,
        password: password || undefined,
      }),
    onSuccess: (created) => {
      setPending(null);
      remember(created);
    },
  });

  // The sample opens straight into the review UI: the point is to land someone
  // in a working review, not to show them another form.
  const demo = useMutation({
    mutationFn: () => api.createDemoPreview(),
    onSuccess: openAsOwner,
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
        openAsOwner(created);
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
  }, []);

  const busy = upload.isPending || importUrl.isPending || demo.isPending;
  const error = upload.error ?? importUrl.error ?? demo.error;

  if (result) return <CreatedPanel result={result} onReset={() => setResult(null)} />;

  const choose = async (directory: boolean) => {
    const picked = await pickFiles({ directory });
    if (!picked) return;
    setSelection(picked);
    setPending('files');
  };

  const confirm = () => (pending === 'url' ? importUrl.mutate() : upload.mutate());

  return (
    <div className="paper">
      <PaperDecor targetRef={stageRef} />

      <div className="paper__shell">
        <header className="paper__head">
          <div className="paper__wordmark">{t('app.name').toLowerCase()}</div>
          <div className="paper__nav">
            {/*
              Only once there is something behind it. A door to an empty room is
              worse than no door, and this browser may never have made anything.
            */}
            {(mine.data?.previews.length ?? 0) > 0 && (
              <a className="paper-link" href="/me">
                {t('home.mine')}
              </a>
            )}
            <button type="button" className="paper-link" onClick={() => setIntro(true)}>
              {t('home.howTo')}
            </button>
            <PageChrome onAgentPanel={() => setShowAgent(true)} />
          </div>
        </header>

        <main className="paper__body">
          <div>
            <h1 className="paper__title">{t('app.name')} Live Preview</h1>
            <div className="paper__underline" aria-hidden="true" />
          </div>
          <p className="paper__lede">{t('app.tagline')}</p>

          <div className="paper__stage" ref={stageRef}>
            {mode === 'drop' && (
              <button
                type="button"
                className="paper-drop"
                data-active={dragging}
                disabled={busy}
                onClick={() => void choose(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={async (event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = await filesFromDataTransfer(event.dataTransfer);
                  if (!dropped) return;
                  setSelection(dropped);
                  setPending('files');
                }}
              >
                <span className="paper-drop__title">{t('home.dropTitle')}</span>
                <span className="paper-drop__hint">{t('home.dropHint')}</span>
              </button>
            )}

            {mode === 'url' && (
              <div className="paper-url">
                <div className="paper-url__row">
                  <input
                    className="paper-input"
                    placeholder={t('home.urlPlaceholder')}
                    aria-label={t('home.urlHeading')}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  <button
                    type="button"
                    className="paper-btn paper-btn--ink"
                    disabled={!url || busy}
                    onClick={() => setPending('url')}
                  >
                    {t('home.import')}
                  </button>
                </div>
                <p className="paper-url__note">{t('home.urlHint')}</p>
              </div>
            )}

            {mode === 'cli' && (
              <div className="paper-cli">
                <div className="paper-cli__cmd">npx @liha/live-preview deploy .</div>
                <div className="paper-cli__note"># build, publish, print the share URL</div>
                <div className="paper-cli__cmd">npx @liha/live-preview comments --json</div>
                <div className="paper-cli__note"># what reviewers asked for</div>
                <div className="paper-cli__cmd">npx @liha/live-preview update ./dist</div>
                <div className="paper-cli__note"># same URL, new version</div>
              </div>
            )}
          </div>

          {mode === 'drop' && (
            <div className="paper__picks">
              <button type="button" className="paper-link" onClick={() => void choose(true)}>
                {t('upload.folder')}
              </button>
            </div>
          )}

          <div className="paper__modes">
            {(['drop', 'url', 'cli'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="paper__mode"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {t(
                  value === 'drop'
                    ? 'home.modeDrop'
                    : value === 'url'
                      ? 'home.modeUrl'
                      : 'home.modeCli',
                )}
              </button>
            ))}
            <button
              type="button"
              className="paper-link paper-link--pen"
              disabled={busy}
              onClick={() => demo.mutate()}
            >
              {demo.isPending ? t('common.loading') : t('home.sample')}
            </button>
          </div>

          {error && <div className="notice notice--error">{messageOf(error)}</div>}
        </main>
      </div>

      {pending && (
        <Modal title={t('home.createHeading')} onClose={() => setPending(null)} bare>
          <div className="paper-tokens paper-sheet paper-sheet--narrow">
            <h2 className="paper-sheet__title">{t('home.createHeading')}</h2>

            {pending === 'files' && selection && (
              <div className="paper-sheet__selection">
                <p>
                  {t.plural('home.ready', selection.parts.length)} ·{' '}
                  {formatBytes(selection.totalBytes)}
                </p>
                {/* What you are about to publish, by name. A count and a size
                    do not tell you whether you picked the right folder. */}
                <p className="paper-sheet__paths">
                  {selection.parts
                    .slice(0, 4)
                    .map((part) => part.path)
                    .join('  ·  ')}
                  {selection.parts.length > 4 ? ` … +${selection.parts.length - 4}` : ''}
                </p>
              </div>
            )}

            <div className="paper-sheet__fields">
              <label>
                <span className="paper-sheet__label">{t('home.title')}</span>
                <input
                  className="paper-ruled"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('home.titlePlaceholder')}
                />
              </label>
              <label>
                <span className="paper-sheet__label">{t('home.password')}</span>
                <input
                  className="paper-ruled"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('home.passwordPlaceholder')}
                />
              </label>
            </div>

            <div className="paper-sheet__foot">
              <button type="button" className="paper-link" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="paper-btn" disabled={busy} onClick={confirm}>
                {busy ? t('common.loading') : t('home.create')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {intro && (
        <Onboarding
          onClose={() => setIntro(false)}
          onSample={() => {
            setIntro(false);
            demo.mutate();
          }}
        />
      )}

      {showAgent && <AgentPanel registration={registration} onClose={() => setShowAgent(false)} />}
    </div>
  );
}

function CreatedPanel({ result, onReset }: { result: CreatePreviewResult; onReset(): void }) {
  const t = useT();

  return (
    <div className="paper">
      <div className="paper__shell">
        <header className="paper__head">
          <div className="paper__wordmark">{t('app.name').toLowerCase()}</div>
          <div className="paper__nav">
            <PageChrome />
          </div>
        </header>

        <main className="paper__body">
          <div>
            <h1 className="paper__title" style={{ fontSize: 'clamp(28px, 3.4vw, 44px)' }}>
              {t('created.title')}
            </h1>
            <div className="paper__underline" aria-hidden="true" />
          </div>
          <p className="paper__lede">{t('created.body')}</p>

          <div className="paper-sheet" style={{ maxWidth: 560 }}>
            <div className="stack">
              <CopyField label={t('share.url')} value={result.preview.shareUrl} />
              <CopyField label={t('created.ownerLink')} value={result.ownerUrl} />
              <CopyField label={t('share.ownerToken')} value={result.ownerToken} />
              <p className="paper-url__note" style={{ margin: 0 }}>
                {t('created.ownerNote')}
              </p>
            </div>
          </div>

          <div className="paper__picks">
            <a className="paper-btn paper-btn--ink" href={result.ownerUrl}>
              {t('created.open')}
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
            <button type="button" className="paper-btn paper-btn--quiet" onClick={onReset}>
              {t('created.another')}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
