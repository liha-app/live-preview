import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Files, FolderOpen, Lock } from 'lucide-react';
import type { Preview, ShareInfo, Version } from '@liha/shared';
import { formatBytes } from '@liha/shared';
import { filesFromDataTransfer, pickFiles, type UploadSelection } from '../lib/files.js';
import { useI18n, useT } from '../i18n/index.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
  /**
   * Drops the default box so the dialog can bring its own — the landing page's
   * paper sheet, for one. The dialog keeps `aria-label`, so its accessible name
   * survives the visible heading going away.
   */
  bare = false,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
  bare?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  /*
   * Held in a ref so the effect below can depend on nothing.
   *
   * `onClose` is usually written inline at the call site, which makes it a new
   * function on every render. With it in the dependency list the whole trap
   * tore down and set itself up again on every keystroke — including the line
   * that moves focus to the first field — so typing a password sent the caret
   * back to the title after the first character.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /*
   * A modal has to own the keyboard while it is open: focus moves inside on
   * open, Tab cycles within it, and focus returns to whatever opened it on
   * close. Without this a keyboard user tabs straight out into the page behind.
   *
   * Mount and unmount only. Everything it does is a one-time arrangement.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={bare ? 'modal modal--bare' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        {!bare && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <div className="stack" style={{ gap: 5 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <div className="copyable">
        <code>{value}</code>
        <button
          type="button"
          className="btn btn--sm btn--quiet btn--icon"
          aria-label={`${t('common.copy')}: ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

function FilePicker({
  selection,
  onSelect,
}: {
  selection: UploadSelection | null;
  onSelect(selection: UploadSelection | null): void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className="dropzone"
      data-active={dragging}
      style={{ padding: 26 }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        onSelect(await filesFromDataTransfer(event.dataTransfer));
      }}
    >
      {selection ? (
        <div>
          <strong>{t.plural('upload.fileCount', selection.parts.length)}</strong>
          <div className="faint">{formatBytes(selection.totalBytes)}</div>
        </div>
      ) : (
        <span className="muted">{t('upload.drop')}</span>
      )}
      <div className="dropzone__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => onSelect(await pickFiles({ directory: false }))}
        >
          <Files size={13} strokeWidth={1.75} aria-hidden="true" />
          {t('upload.files')}
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => onSelect(await pickFiles({ directory: true }))}
        >
          <FolderOpen size={13} strokeWidth={1.75} aria-hidden="true" />
          {t('upload.folder')}
        </button>
      </div>
    </div>
  );
}

export function ShareModal({
  preview,
  share,
  ownerToken,
  onClose,
}: {
  preview: Preview;
  share: ShareInfo | null;
  ownerToken: string | null;
  onClose(): void;
}) {
  const t = useT();

  return (
    <Modal title={t('share.title')} onClose={onClose}>
      <CopyField label={t('share.url')} value={preview.shareUrl} />
      <CopyField label={t('share.previewId')} value={preview.id} />
      {ownerToken && <CopyField label={t('share.ownerToken')} value={ownerToken} />}
      {share && (
        <label className="stack" style={{ gap: 5 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('share.summary')}
          </span>
          <textarea
            className="field"
            readOnly
            rows={3}
            value={share.summaryText}
            aria-label={t('share.summary')}
          />
        </label>
      )}
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </Modal>
  );
}

export function UploadVersionModal({
  busy,
  error,
  sourceUrl,
  onClose,
  onSubmit,
  onRefetch,
}: {
  busy: boolean;
  error: string | null;
  /**
   * Where this preview was imported from, when it was. Present means the
   * useful thing here is fetching that page again, not picking files — a
   * preview made from a URL had no way to be brought up to date at all.
   */
  sourceUrl: string | null;
  onClose(): void;
  onSubmit(selection: UploadSelection, label: string): void;
  onRefetch(url: string, label: string): void;
}) {
  const t = useT();
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState(sourceUrl ?? '');

  if (sourceUrl !== null) {
    return (
      <Modal title={t('upload.title')} onClose={onClose}>
        <p className="muted" style={{ margin: 0 }}>
          {t('upload.explainUrl')}
        </p>
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('upload.sourceUrl')}
          </span>
          {/* Editable: the next version of a site is often a different page of it. */}
          <input
            className="field"
            aria-label={t('upload.sourceUrl')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <input
          className="field"
          placeholder={t('upload.label')}
          aria-label={t('upload.label')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {error && <div className="notice notice--error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!url.trim() || busy}
            onClick={() => onRefetch(url.trim(), label)}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('upload.refetch')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('upload.title')} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        {t('upload.explain')}
      </p>
      <FilePicker selection={selection} onSelect={setSelection} />
      <input
        className="field"
        placeholder={t('upload.label')}
        aria-label={t('upload.label')}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      {error && <div className="notice notice--error">{error}</div>}
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!selection || busy}
          onClick={() => selection && onSubmit(selection, label)}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {t('upload.publish')}
        </button>
      </div>
    </Modal>
  );
}

export function OwnerSettingsModal({
  preview,
  versions,
  busy,
  error,
  onClose,
  onSetPassword,
  onSetCurrentVersion,
  onDelete,
}: {
  preview: Preview;
  versions: Version[];
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSetPassword(password: string | null): void;
  onSetCurrentVersion(versionId: string): void;
  onDelete(): void;
}) {
  const { t, locale } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = versions.find((version) => version.isCurrent);

  return (
    <Modal title={t('owner.title')} onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('owner.currentVersion')}
        </span>
        <select
          className="select"
          aria-label={t('owner.currentVersion')}
          value={current?.id ?? ''}
          onChange={(event) => onSetCurrentVersion(event.target.value)}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.number} · {new Date(version.createdAt).toLocaleString(locale)} ·{' '}
              {formatBytes(version.byteSize)}
            </option>
          ))}
        </select>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('owner.password')} ·{' '}
          {preview.passwordProtected ? t('owner.passwordSet') : t('owner.passwordOff')}
        </span>
        <div className="row">
          <input
            className="field"
            type="password"
            placeholder={t('owner.newPassword')}
            aria-label={t('owner.newPassword')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={password.length < 6 || busy}
            onClick={() => {
              onSetPassword(password);
              setPassword('');
            }}
          >
            <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
            {t('owner.set')}
          </button>
          {preview.passwordProtected && (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy}
              onClick={() => onSetPassword(null)}
            >
              {t('owner.remove')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="notice notice--error">{error}</div>}

      <div className="modal__actions" style={{ justifyContent: 'space-between' }}>
        {confirmDelete ? (
          <button type="button" className="btn btn--danger" disabled={busy} onClick={onDelete}>
            {t('owner.deleteConfirm')}
          </button>
        ) : (
          <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
            {t('owner.delete')}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </Modal>
  );
}

export function PasswordGate({
  onSubmit,
  error,
  busy,
}: {
  onSubmit(password: string): void;
  error: string | null;
  busy: boolean;
}) {
  const t = useT();
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="center-pane">
      <form
        className="stack"
        style={{ width: 'min(300px, 100%)', textAlign: 'center' }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
      >
        <Lock size={18} strokeWidth={1.5} style={{ margin: '0 auto' }} aria-hidden="true" />
        <p className="muted" style={{ margin: 0 }}>
          {t('password.protected')}
        </p>
        <input
          ref={inputRef}
          className="field"
          type="password"
          placeholder={t('password.placeholder')}
          aria-label={t('password.placeholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <div className="notice notice--error">{error}</div>}
        <button type="submit" className="btn btn--primary" disabled={!password || busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {t('password.unlock')}
        </button>
      </form>
    </div>
  );
}
