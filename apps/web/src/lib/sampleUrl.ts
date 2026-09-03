/**
 * The share URL the illustrations draw.
 *
 * Built from this deployment's own review-origin template, handed to the build
 * by scripts/deploy.mjs the same way the API URL is. Before that it was
 * invented — `<app host>/p/8fa2c1` — and that shape is not one this service
 * has ever served: reviews live on a host of their own, not on a path under
 * the app. A drawing that teaches "this is your link" should not be the one
 * thing on the page that gets the link wrong.
 *
 * Returns null when the template is unknown, which is the case for `pnpm dev`
 * and for any build that did not go through the deploy script. The drawings
 * then leave the address bar blank rather than guessing again.
 */
const TEMPLATE = import.meta.env.VITE_REVIEW_ORIGIN_TEMPLATE as string | undefined;

/*
 * Short and invented on purpose. The picture is teaching "this link never
 * changes", not what a slug looks like, and a real twelve-character one
 * overflows the little browser window it sits in.
 */
const SAMPLE_SLUG = '8fa2c1';

export function sampleShareUrl(): string | null {
  if (!TEMPLATE?.includes('{slug}')) return null;
  try {
    // Shown without the scheme: it is an address bar, not a link to copy.
    return new URL(TEMPLATE.replace('{slug}', SAMPLE_SLUG)).host;
  } catch {
    return null;
  }
}
