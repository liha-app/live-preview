import { useState } from 'react';
import { Check, CornerDownRight, MessageSquare, RotateCcw, Sparkles } from 'lucide-react';
import type { Comment } from '@liha-cli/shared';
import { CommentComposer } from './CommentComposer.js';
import { formatRelativeTime, useI18n, useT } from '../i18n/index.js';

interface Props {
  root: Comment;
  replies: Comment[];
  index: number;
  selected: boolean;
  isOwner: boolean;
  authorName: string;
  replying: boolean;
  replyBody: string;
  replySubmitting: boolean;
  onSelect(): void;
  onHover(hovering: boolean): void;
  onStartReply(): void;
  onCancelReply(): void;
  onReplyChange(body: string): void;
  onAuthorChange(name: string): void;
  onSubmitReply(input: { body: string; authorName: string }): void;
  onResolve(): void;
  onReopen(): void;
}

/**
 * Who wrote this.
 *
 * An agent's contribution is marked, because the whole claim of the product is
 * that an agent joined the review rather than read a transcript of it — and
 * without a mark that claim looks, on screen, like a differently-spelled name.
 * The mark is quiet: this is still a review screen, and the artifact is what
 * should hold the eye.
 */
function Byline({ comment }: { comment: Comment }) {
  const t = useT();
  if (comment.authorKind !== 'agent') {
    return <span className="comment__author">{comment.authorName}</span>;
  }
  return (
    <span className="comment__author" data-agent="true">
      <Sparkles size={11} strokeWidth={2} aria-hidden="true" />
      {comment.authorName}
      <span className="visually-hidden"> — {t('comments.byAgent')}</span>
    </span>
  );
}

export function CommentThread({
  root,
  replies,
  index,
  selected,
  isOwner,
  authorName,
  replying,
  replyBody,
  replySubmitting,
  onSelect,
  onHover,
  onStartReply,
  onCancelReply,
  onReplyChange,
  onAuthorChange,
  onSubmitReply,
  onResolve,
  onReopen,
}: Props) {
  const { t, locale } = useI18n();
  const [showAllReplies, setShowAllReplies] = useState(false);
  const collapsed = !selected && !showAllReplies && replies.length > 2;
  const visibleReplies = collapsed ? replies.slice(-1) : replies;
  const target = root.target.element?.selector ?? root.targetDescription;

  return (
    <li
      className="thread"
      data-selected={selected}
      data-status={root.status}
      id={`comment-${root.id}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div
        className="thread__root"
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        aria-label={t('comments.byAuthor', {
          index,
          author: root.authorName,
          body: root.body,
        })}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <div className="comment__head">
          <span className="comment__num" aria-hidden="true">
            {index}
          </span>
          <Byline comment={root} />
          <span className="spacer" />
          <time
            className="faint"
            dateTime={root.createdAt}
            title={new Date(root.createdAt).toLocaleString(locale)}
          >
            {formatRelativeTime(root.createdAt, locale)}
          </time>
        </div>

        <div className="comment__body">{root.body}</div>

        <div className="comment__meta">
          <span className="comment__selector" title={target}>
            {target}
          </span>
          <span className="spacer" />
          <span className="faint">
            v{root.versionNumber ?? '?'}
            {root.stale ? ` · ${t('comments.outdated')}` : ''}
          </span>
        </div>
      </div>

      {visibleReplies.length > 0 && (
        <ul className="thread__replies list-reset">
          {collapsed && (
            <li>
              <button
                type="button"
                className="btn btn--sm btn--quiet thread__more"
                onClick={() => setShowAllReplies(true)}
              >
                {t.plural('comments.showEarlier', replies.length - 1)}
              </button>
            </li>
          )}
          {visibleReplies.map((reply) => (
            <li key={reply.id} className="reply">
              <div className="comment__head">
                <CornerDownRight
                  size={12}
                  strokeWidth={1.75}
                  className="faint"
                  aria-hidden="true"
                />
                <Byline comment={reply} />
                <span className="spacer" />
                <time
                  className="faint"
                  dateTime={reply.createdAt}
                  title={new Date(reply.createdAt).toLocaleString(locale)}
                >
                  {formatRelativeTime(reply.createdAt, locale)}
                </time>
              </div>
              <div className="comment__body">{reply.body}</div>
            </li>
          ))}
        </ul>
      )}

      {replying ? (
        <div className="thread__composer">
          <CommentComposer
            value={replyBody}
            authorName={authorName}
            targetLabel={null}
            submitting={replySubmitting}
            placeholder={t('comments.replyTo', { name: root.authorName })}
            submitLabel={t('composer.submitReply')}
            autoFocus
            compact
            onChange={onReplyChange}
            onAuthorChange={onAuthorChange}
            onSubmit={onSubmitReply}
            onCancel={onCancelReply}
          />
        </div>
      ) : (
        <div className="comment__actions">
          <button type="button" className="btn btn--sm btn--quiet" onClick={onStartReply}>
            <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
            {t('comments.reply')}
            {replies.length > 0 && <span className="faint"> · {replies.length}</span>}
          </button>
          {isOwner &&
            (root.status === 'open' ? (
              <button type="button" className="btn btn--sm" onClick={onResolve}>
                <Check size={13} strokeWidth={2} aria-hidden="true" />
                {t('comments.resolve')}
              </button>
            ) : (
              <button type="button" className="btn btn--sm btn--quiet" onClick={onReopen}>
                <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                {t('comments.reopen')}
              </button>
            ))}
        </div>
      )}
    </li>
  );
}
