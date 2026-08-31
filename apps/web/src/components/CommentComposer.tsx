import { useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { useT } from '../i18n/index.js';

export interface ComposerSubmit {
  body: string;
  authorName: string;
}

interface Props {
  value: string;
  authorName: string;
  targetLabel: string | null;
  submitting: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  submitLabel?: string;
  onChange(body: string): void;
  onAuthorChange(name: string): void;
  onSubmit(input: ComposerSubmit): void;
  onCancel?(): void;
}

/** Grows with its content instead of making the writer scroll a 3-line box. */
function useAutoGrow(value: string, max = 260) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, max)}px`;
    element.style.overflowY = element.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, max]);
  return ref;
}

export function CommentComposer({
  value,
  authorName,
  targetLabel,
  submitting,
  placeholder,
  autoFocus = false,
  compact = false,
  submitLabel,
  onChange,
  onAuthorChange,
  onSubmit,
  onCancel,
}: Props) {
  const t = useT();
  const textareaRef = useAutoGrow(value);
  const [showName, setShowName] = useState(() => authorName.trim().length === 0);

  const prompt = placeholder ?? t('composer.placeholder');
  const submitText = submitLabel ?? t('composer.submit');

  // Focus before paint. Deferring this to a frame callback dropped the first
  // keystroke when someone started typing the moment the composer appeared.
  useLayoutEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus, textareaRef]);

  const canSubmit = value.trim().length > 0 && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ body: value.trim(), authorName: authorName.trim() || 'Anonymous' });
  };

  return (
    <div className={`composer${compact ? ' composer--compact' : ''}`}>
      {targetLabel && (
        <div className="composer__target">
          <span className="composer__target-text" title={targetLabel}>
            {targetLabel}
          </span>
          {onCancel && (
            <button
              type="button"
              className="btn btn--sm btn--quiet btn--icon"
              onClick={onCancel}
              aria-label={t('composer.removeTarget')}
              title={t('composer.clearTargetHint')}
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="field composer__input"
        rows={compact ? 1 : 2}
        placeholder={prompt}
        value={value}
        aria-label={prompt}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />

      <div className="composer__actions">
        {showName ? (
          <input
            className="field composer__name"
            placeholder={t('composer.yourName')}
            value={authorName}
            aria-label={t('composer.yourName')}
            onChange={(event) => onAuthorChange(event.target.value)}
            onBlur={() => authorName.trim() && setShowName(false)}
          />
        ) : (
          <button
            type="button"
            className="btn btn--sm btn--quiet composer__whoami"
            onClick={() => setShowName(true)}
            title={t('composer.changeName')}
          >
            {authorName}
          </button>
        )}
        <span className="spacer" />
        {onCancel && (
          <button type="button" className="btn btn--sm btn--quiet" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!canSubmit}
          onClick={submit}
          title={t('composer.submitHint')}
        >
          {submitting ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <CornerDownLeft size={13} strokeWidth={1.75} aria-hidden="true" />
          )}
          {submitText}
        </button>
      </div>
    </div>
  );
}
