/**
 * The preview this hostname is dedicated to, if it is dedicated to one.
 *
 * When a deployment gives each preview its own host, the Worker stamps the slug
 * into the document it serves. The app reads it from there rather than parsing
 * the hostname itself: the shape of that hostname is deployment configuration —
 * `lp-{slug}.liha.review` here, something else elsewhere — and the app has no
 * business knowing it.
 *
 * Read once. A document is served for one preview and does not become another.
 */
const stamped = (() => {
  if (typeof document === 'undefined') return null;
  const value = document.querySelector('meta[name="liha:slug"]')?.getAttribute('content')?.trim();
  return value || null;
})();

export function ownPreviewSlug(): string | null {
  return stamped;
}
