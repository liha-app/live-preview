import { useState } from 'react';
import { Check, Copy, Sparkles } from 'lucide-react';
import type { RegistrationHandle } from '@liha/webmcp';
import { Modal } from './Dialogs.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/en.js';

const PROMPTS: MessageKey[] = ['agent.prompt1', 'agent.prompt2', 'agent.prompt3'];

/** Tools that change something the human can see, as opposed to pure reads. */
const ACTING = new Set([
  'add_comment',
  'resolve_comment',
  'focus_comment',
  'set_viewport',
  'create_preview_from_url',
]);

function PromptRow({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="copyable">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn--sm btn--quiet btn--icon"
        aria-label={`Copy: ${text}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
      </button>
    </li>
  );
}

/**
 * Makes the WebMCP layer visible.
 *
 * Without this the page's entire agent contribution is invisible — someone
 * would have to already know the tools exist to use them, and would have no way
 * to tell whether their browser supports the API or the page simply failed to
 * register. It also removes the "what do I even ask?" problem by suggesting
 * prompts that exercise the tools only a page can provide.
 */
export function AgentPanel({
  registration,
  onClose,
}: {
  registration: RegistrationHandle | null;
  onClose(): void;
}) {
  const t = useT();
  const available = registration?.available ?? false;
  const toolNames = registration?.toolNames ?? [];

  return (
    <Modal title={t('agent.title')} onClose={onClose}>
      <div className={`notice${available ? '' : ' notice--muted'}`}>
        <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>
          {available ? t('agent.available', { count: toolNames.length }) : t('agent.unavailable')}
        </span>
      </div>

      {available && registration?.detected && (
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          {t('agent.detected', {
            source: registration.detected.source,
            style: registration.detected.style,
          })}
        </p>
      )}

      {!available && (
        <p className="muted" style={{ margin: 0 }}>
          {t('agent.howto')}
        </p>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('agent.tryAsking')}
        </span>
        <ul className="list-reset stack" style={{ gap: 6 }}>
          {PROMPTS.map((key) => (
            <PromptRow key={key} text={t(key)} />
          ))}
        </ul>
      </div>

      {toolNames.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('agent.toolsHeading')}
          </span>
          <ul className="list-reset tool-list">
            {toolNames.map((name) => (
              <li key={name}>
                <code>{name}</code>
                <span className={`tag${ACTING.has(name) ? ' tag--acts' : ''}`}>
                  {ACTING.has(name) ? t('agent.writes') : t('agent.readOnly')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
