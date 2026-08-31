import { useEffect, useRef } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import type { Comment, CommentFilter } from '@liha/shared';
import { CommentComposer } from './CommentComposer.js';
import { CommentThread } from './CommentThread.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/en.js';

export interface Thread {
  root: Comment;
  replies: Comment[];
}

interface Props {
  threads: Thread[];
  counts: { open: number; resolved: number; total: number };
  filter: CommentFilter;
  isOwner: boolean;
  loading: boolean;
  selectedId: string | null;
  authorName: string;
  /** Set when the reviewer has marked a target but the inline composer is not shown. */
  draftLabel: string | null;
  /** False while the floating composer is open, so the draft has one home. */
  showComposer: boolean;
  draftBody: string;
  submitting: boolean;
  replyingTo: string | null;
  replyBody: string;
  replySubmitting: boolean;
  onFilterChange(filter: CommentFilter): void;
  onSelect(id: string | null): void;
  onHover(id: string | null): void;
  onAuthorChange(name: string): void;
  onDraftChange(body: string): void;
  onSubmit(input: { body: string; authorName: string }): void;
  onCancelDraft(): void;
  onStartReply(id: string): void;
  onCancelReply(): void;
  onReplyChange(body: string): void;
  onSubmitReply(input: { body: string; authorName: string }): void;
  onResolve(comment: Comment): void;
  onReopen(comment: Comment): void;
}

const FILTERS: { id: CommentFilter; label: MessageKey }[] = [
  { id: 'open', label: 'filter.open' },
  { id: 'resolved', label: 'filter.resolved' },
  { id: 'all', label: 'filter.all' },
];

export function CommentSidebar(props: Props) {
  const { threads, counts, filter, selectedId, loading } = props;
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the keyboard-selected thread in view as the reviewer moves through them.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector(`#comment-${CSS.escape(selectedId)}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <aside className="sidebar" aria-label={t('comments.title')}>
      <div className="sidebar__head">
        <div className="tabs" role="group" aria-label={t('filter.label')}>
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => props.onFilterChange(id)}
            >
              {t(label)} {id === 'all' ? counts.total : counts[id]}
            </button>
          ))}
        </div>
      </div>

      <ul className="comment-list list-reset" ref={listRef}>
        {loading && threads.length === 0 && (
          <li className="empty" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
          </li>
        )}
        {!loading && threads.length === 0 && (
          <li className="empty">
            <MessageSquarePlus size={18} strokeWidth={1.5} aria-hidden="true" />
            <p>
              {filter === 'open'
                ? t('comments.emptyOpen')
                : filter === 'resolved'
                  ? t('comments.emptyResolved')
                  : t('comments.emptyAll')}
            </p>
            <p className="faint">
              {t('comments.emptyHint', { key: 'C' })
                .split('C')
                .flatMap((part, index) => (index === 0 ? [part] : [<kbd key="k">C</kbd>, part]))}
            </p>
          </li>
        )}
        {threads.map((thread, index) => (
          <CommentThread
            key={thread.root.id}
            root={thread.root}
            replies={thread.replies}
            index={index + 1}
            selected={thread.root.id === selectedId}
            isOwner={props.isOwner}
            authorName={props.authorName}
            replying={props.replyingTo === thread.root.id}
            replyBody={props.replyBody}
            replySubmitting={props.replySubmitting}
            onSelect={() => props.onSelect(thread.root.id === selectedId ? null : thread.root.id)}
            onHover={(hovering) => props.onHover(hovering ? thread.root.id : null)}
            onStartReply={() => props.onStartReply(thread.root.id)}
            onCancelReply={props.onCancelReply}
            onReplyChange={props.onReplyChange}
            onAuthorChange={props.onAuthorChange}
            onSubmitReply={props.onSubmitReply}
            onResolve={() => props.onResolve(thread.root)}
            onReopen={() => props.onReopen(thread.root)}
          />
        ))}
      </ul>

      {/*
        The floating composer handles targeted comments next to the artifact, and
        owns the draft while it is open. This one covers notes about the version
        as a whole, and the keyboard path where there is no pin to anchor to.
      */}
      {props.showComposer ? (
        <CommentComposer
          value={props.draftBody}
          authorName={props.authorName}
          targetLabel={props.draftLabel}
          submitting={props.submitting}
          placeholder={t('composer.placeholderVersion')}
          onChange={props.onDraftChange}
          onAuthorChange={props.onAuthorChange}
          onSubmit={props.onSubmit}
          {...(props.draftLabel ? { onCancel: props.onCancelDraft } : {})}
        />
      ) : (
        <div className="composer composer--handover faint">{t('composer.writing')}</div>
      )}
    </aside>
  );
}
