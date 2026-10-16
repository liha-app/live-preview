import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/index.js';
import { CommentSidebar } from './CommentSidebar.js';

const noop = () => {};
const props: ComponentProps<typeof CommentSidebar> = {
  open: true,
  threads: [],
  counts: { open: 0, resolved: 0, total: 0 },
  filter: 'open',
  isOwner: false,
  loading: false,
  selectedId: null,
  authorName: '',
  draftLabel: null,
  showComposer: true,
  draftBody: '',
  submitting: false,
  replyingTo: null,
  replyBody: '',
  replySubmitting: false,
  onNotifications: noop,
  onAccount: null,
  onFilterChange: noop,
  onSelect: noop,
  onHover: noop,
  onAuthorChange: noop,
  onDraftChange: noop,
  onSubmit: noop,
  onCancelDraft: noop,
  onStartReply: noop,
  onCancelReply: noop,
  onReplyChange: noop,
  onSubmitReply: noop,
  onResolve: noop,
  onReopen: noop,
};

afterEach(() => window.localStorage.removeItem('liha.locale'));

describe.each(['en', 'ja'])('empty comment hints (%s)', (locale) => {
  it.each(['open', 'resolved', 'all'] as const)(
    'keeps the %s hint intact and marks only the shortcut as a key',
    (filter) => {
      window.localStorage.setItem('liha.locale', locale);
      const html = renderToStaticMarkup(
        <I18nProvider>
          <CommentSidebar {...props} filter={filter} />
        </I18nProvider>,
      );
      const dom = new DOMParser().parseFromString(html, 'text/html');
      const hint = dom.querySelector('.empty .faint')!;
      expect(hint.querySelectorAll('kbd')).toHaveLength(1);
      expect(hint.querySelector('kbd')?.textContent).toBe('C');
      expect(hint.textContent).toBe(
        locale === 'en'
          ? 'Click anywhere on the preview to leave one, or press C.'
          : 'プレビューをクリックするか、C キーでコメントを追加できます。',
      );
    },
  );
});
