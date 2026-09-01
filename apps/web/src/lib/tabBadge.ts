/**
 * The unread count, in the two places a background tab can show one.
 *
 * The icon carries it, not the title: once a few tabs are open the title is
 * down to a couple of characters, and it is the favicon you actually recognise.
 * The title is still set, for the case where the tab is wide enough to read and
 * for anything reading the page rather than looking at it.
 *
 * Drawn as SVG rather than on a canvas so it stays sharp at whatever size the
 * browser asks for, and needs no DOM to produce.
 */

const MARK = '#e5484d';

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`,
  )}`;

/** Nothing waiting: an open ring. */
export const IDLE_ICON = svg(
  `<circle cx="16" cy="16" r="11" fill="none" stroke="${MARK}" stroke-width="3.5"/>`,
);

/** Something waiting: the ring fills in and carries the number. */
export function badgedIcon(count: number): string {
  const label = count > 9 ? '9+' : String(count);
  return svg(
    `<circle cx="16" cy="16" r="13" fill="${MARK}"/>` +
      `<text x="16" y="16" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="sans-serif" font-size="${label.length > 1 ? 15 : 18}" ` +
      `font-weight="700" fill="#fff">${label}</text>`,
  );
}

export function badgedTitle(count: number, title: string): string {
  return count > 0 ? `(${count}) ${title}` : title;
}

/**
 * Points the tab's icon at `href`.
 *
 * The link element is replaced rather than re-pointed: browsers are inconsistent
 * about re-reading an icon whose `href` changed in place.
 */
export function setFavicon(href: string): void {
  const existing = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  if (existing.length === 1 && existing[0]?.href === href) return;

  existing.forEach((link) => link.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = href;
  document.head.append(link);
}

export function applyTabBadge(count: number, title: string): void {
  document.title = badgedTitle(count, title);
  setFavicon(count > 0 ? badgedIcon(count) : IDLE_ICON);
}
