import type { ReactNode } from 'react';
import { Lock, Settings2, Share2, Sparkles, Upload } from 'lucide-react';
import type { Preview, Version } from '@liha/shared';
import { useT } from '../i18n/index.js';

interface Props {
  children?: ReactNode;
  preview: Preview;
  versions: Version[];
  activeVersionId: string | null;
  isOwner: boolean;
  agentActive: boolean;
  onVersionChange(versionId: string): void;
  onShare(): void;
  onUpload(): void;
  onSettings(): void;
  onAgentPanel(): void;
}

export function TopBar({
  children,
  preview,
  versions,
  activeVersionId,
  isOwner,
  agentActive,
  onVersionChange,
  onShare,
  onUpload,
  onSettings,
  onAgentPanel,
}: Props) {
  const t = useT();

  return (
    <header className="topbar">
      <a className="topbar__brand" href="/" title={t('app.name')}>
        {t('app.name')}
      </a>
      <span className="topbar__title" title={preview.title}>
        {preview.title}
      </span>
      {preview.passwordProtected && (
        <Lock size={13} className="faint" role="img" aria-label={t('topbar.passwordProtected')} />
      )}
      {/*
        Always offered, not only when WebMCP is present: someone whose browser
        lacks it needs to be told that, not left wondering.
      */}
      <button
        type="button"
        className={`btn btn--sm btn--quiet topbar__agent${agentActive ? ' is-live' : ''}`}
        onClick={onAgentPanel}
        title={agentActive ? t('topbar.agentConnected') : t('agent.unavailable')}
        aria-label={t('agent.open')}
      >
        <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
        {agentActive && <span className="topbar__agent-dot" aria-hidden="true" />}
      </button>

      <span className="spacer" />

      {children}

      <select
        className="select"
        value={activeVersionId ?? ''}
        onChange={(event) => onVersionChange(event.target.value)}
        aria-label={t('topbar.version')}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            v{version.number}
            {version.isCurrent ? ` · ${t('topbar.versionCurrent')}` : ''}
            {version.label ? ` · ${version.label}` : ''}
          </option>
        ))}
      </select>

      <button type="button" className="btn" onClick={onShare}>
        <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
        {t('topbar.share')}
      </button>
      {isOwner && (
        <>
          <button type="button" className="btn btn--primary" onClick={onUpload}>
            <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
            {t('topbar.update')}
          </button>
          <button
            type="button"
            className="btn btn--icon btn--quiet"
            onClick={onSettings}
            aria-label={t('topbar.ownerSettings')}
            title={t('topbar.ownerSettings')}
          >
            <Settings2 size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </>
      )}
    </header>
  );
}
