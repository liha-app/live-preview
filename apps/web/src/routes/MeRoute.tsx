import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LogOut, MessageSquare, Sparkles } from 'lucide-react';
import { formatBytes } from '@liha-cli/shared';
import { API_URL, api } from '../lib/api.js';
import { useI18n, useT } from '../i18n/index.js';
import { timeLeft } from '../lib/expiry.js';
import { GoogleSignIn } from '../components/GoogleSignIn.js';
import { LocaleToggle } from '../components/LocaleToggle.js';
import { appHome } from '../lib/ownPreview.js';

/**
 * Everything this browser is involved in.
 *
 * Reachable without signing in, because the account behind it is minted
 * anonymously the first time somebody does anything. Signing in is what carries
 * this to another browser — and buys a longer window before things are deleted
 * — not what makes it exist.
 *
 * Deliberately plain, like the review screen: this is a workspace, not a front
 * door.
 */
export function MeRoute() {
  const t = useT();
  const { locale } = useI18n();
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: () => api.getMe() });
  const previews = useQuery({ queryKey: ['me', 'previews'], queryFn: () => api.listMyPreviews() });
  const activity = useQuery({ queryKey: ['me', 'activity'], queryFn: () => api.listMyActivity() });

  const signOut = useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const account = me.data?.account ?? null;
  const rows = previews.data?.previews ?? [];
  const events = activity.data?.activity ?? [];
  const when = (iso: string) => new Date(iso).toLocaleString(locale);

  const signInHref = `${API_URL}/api/auth/google/start?return=${encodeURIComponent(
    window.location.href,
  )}`;

  return (
    <div className="me">
      <header className="me__head">
        <a className="topbar__brand" href={appHome()}>
          <img src="/liha-mark.svg" alt="" width="13" height="16" />
          {t('app.name')}
        </a>
        <span className="spacer" />
        <LocaleToggle />
        {account?.signedIn ? (
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              {account.email ?? account.displayName ?? t('me.signedIn')}
            </span>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
              {t('me.signOut')}
            </button>
          </>
        ) : (
          me.data?.googleAvailable && <GoogleSignIn href={signInHref} />
        )}
      </header>

      <main className="me__body">
        {!account && !me.isLoading && <p className="muted">{t('me.nothingYet')}</p>}

        {!account?.signedIn && me.data && (
          /*
           * Said here rather than on a banner somewhere: this is the one page
           * where somebody is looking at things they would rather not lose.
           */
          <p className="notice">
            {t('me.retention', {
              anonymous: String(me.data.retentionDays.anonymous),
              signedIn: String(me.data.retentionDays.signedIn),
            })}
          </p>
        )}

        <section>
          <h2 className="me__title">{t('me.previews')}</h2>
          {rows.length === 0 ? (
            <p className="muted">{t('me.noPreviews')}</p>
          ) : (
            <ul className="me__list list-reset">
              {rows.map((preview) => {
                const left = timeLeft(preview.expiresAt);
                return (
                  <li key={preview.id}>
                    <a href={preview.shareUrl} className="me__row">
                      <span className="me__name">{preview.title}</span>
                      <span className="me__meta">
                        {preview.role === 'owner' ? t('me.owner') : t('me.reviewer')}
                        {' · '}
                        {t('me.openComments', { count: String(preview.openCommentCount) })}
                        {preview.manifest ? ` · ${formatBytes(preview.manifest.totalBytes)}` : ''}
                        {left ? ` · ${t('me.left', { days: String(Math.max(left.days, 0)) })}` : ''}
                      </span>
                      <ArrowUpRight
                        size={14}
                        strokeWidth={1.75}
                        className="faint"
                        aria-hidden="true"
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="me__title">{t('me.activity')}</h2>
          {events.length === 0 ? (
            <p className="muted">{t('me.noActivity')}</p>
          ) : (
            <ul className="me__list list-reset">
              {events.map((event) => (
                <li key={event.commentId}>
                  <a href={event.url} className="me__row">
                    {event.authorKind === 'agent' ? (
                      <Sparkles size={14} strokeWidth={1.75} className="faint" aria-hidden="true" />
                    ) : (
                      <MessageSquare
                        size={14}
                        strokeWidth={1.75}
                        className="faint"
                        aria-hidden="true"
                      />
                    )}
                    <span className="me__name">
                      <b>{event.authorName}</b> {event.body}
                    </span>
                    <span className="me__meta">
                      {event.previewTitle} · {when(event.createdAt)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
