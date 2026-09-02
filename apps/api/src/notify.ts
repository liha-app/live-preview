import { assertPublicHttpUrl } from '@liha/shared';
import type { Env, ResolvedConfig } from './env.js';
import { sendPush, type VapidKeys } from './push.js';
import {
  deletePushSubscription,
  findPreviewById,
  listCommentsSince,
  markWatchNotified,
  watchersOf,
  watchesOf,
} from './repo.js';
import { shareUrl } from './serialize.js';

/**
 * Whether this deployment can send push at all.
 *
 * Both halves are needed and neither has a sane default: the public key is what
 * browsers subscribe with, and changing it silently invalidates every existing
 * subscription. A deployment without them simply does not offer notifications,
 * rather than offering them and dropping them.
 */
export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKeyJwk: env.VAPID_PRIVATE_KEY };
}

/**
 * The `sub` claim: who to contact about these messages.
 *
 * RFC 8292 accepts an https URL as well as a mailto, so this needs no address
 * to be configured — the deployment's own origin identifies it.
 */
function subjectFor(env: Env, config: ResolvedConfig): string {
  return env.VAPID_SUBJECT ?? config.appOrigin;
}

/**
 * Rejects an endpoint this server must never be talked into fetching.
 *
 * A push endpoint is a URL supplied by the client and later fetched by the
 * server, which is the shape of every SSRF. The same check the URL importer
 * uses applies here, plus https only: a push service does not answer over
 * plaintext, so anything that does is not one.
 */
export function isUsableEndpoint(endpoint: string): boolean {
  try {
    return assertPublicHttpUrl(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Wakes everyone watching a preview.
 *
 * The message is empty; the worker asks what changed. Subscriptions the push
 * service has forgotten are dropped, anything else is left alone — a push
 * service having a bad minute must not cost somebody their notifications.
 */
export async function notifyWatchers(
  env: Env,
  config: ResolvedConfig,
  previewId: string,
): Promise<void> {
  const keys = vapidKeys(env);
  if (!keys) return;

  const subject = subjectFor(env, config);
  for (const subscription of await watchersOf(env.DB, previewId)) {
    const outcome = await sendPush(subscription.endpoint, keys, subject);
    if (outcome === 'gone') await deletePushSubscription(env.DB, subscription.id);
  }
}

export interface PendingItem {
  title: string;
  body: string;
  tag: string;
  url: string;
}

/**
 * What a worker missed, and the mark that it has now been told.
 *
 * Read at display time rather than queued at send time, which is why the push
 * itself carries nothing: what shows up is what is true when it shows up.
 */
export async function pendingFor(
  env: Env,
  config: ResolvedConfig,
  subscriptionId: string,
): Promise<PendingItem[]> {
  const items: PendingItem[] = [];
  const now = new Date().toISOString();

  for (const watch of await watchesOf(env.DB, subscriptionId)) {
    const preview = await findPreviewById(env.DB, watch.preview_id);
    if (!preview) continue;

    const comments = await listCommentsSince(env.DB, watch.preview_id, watch.notified_at);
    if (comments.length === 0) continue;

    const latest = comments[comments.length - 1]!;
    items.push({
      title: preview.title,
      body:
        comments.length === 1
          ? `${latest.author_name}: ${latest.body}`
          : `${comments.length} new comments, latest from ${latest.author_name}`,
      // One notification per preview, replaced rather than stacked: five
      // comments on one page is one thing to go and look at.
      tag: watch.preview_id,
      url: shareUrl(config, preview.slug),
    });
    await markWatchNotified(env.DB, subscriptionId, watch.preview_id, now);
  }

  return items;
}
