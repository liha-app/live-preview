import type { ResolvedConfig } from './env.js';

export interface ContentLocation {
  slug: string;
  versionNumber: number;
}

interface HostPattern {
  protocol: string;
  /** Text before the label, e.g. `lp-` in `lp-{label}.example.net`. */
  prefix: string;
  suffix: string;
  port: string;
}

/**
 * Stands in for `{label}` while the template is parsed as a URL. A valid
 * hostname label that nothing would plausibly use, so finding it is
 * unambiguous even when the prefix or suffix contains the word "label".
 */
const LABEL_MARK = 'lihalabelmark';

/**
 * Every preview version gets its own host label (`<slug>--<n>`) so uploaded HTML
 * lands on a distinct origin. Two consequences matter:
 *  - the browser's same-origin policy keeps it away from the app's storage;
 *  - root-absolute asset paths (`/assets/app.js`, what every bundler emits)
 *    resolve correctly, which a path-prefixed mount cannot do.
 */
export function contentHostLabel(slug: string, versionNumber: number): string {
  return `${slug}--${versionNumber}`;
}

export function parseTemplate(template: string | null): HostPattern | null {
  if (!template || !template.includes('{label}')) return null;
  try {
    const url = new URL(template.replace('{label}', LABEL_MARK));
    const at = url.hostname.indexOf(LABEL_MARK);
    // `{label}` has to land in the hostname. In a path it would give every
    // version the same origin, which is the whole point of this.
    if (at === -1) return null;
    return {
      protocol: url.protocol,
      prefix: url.hostname.slice(0, at),
      suffix: url.hostname.slice(at + LABEL_MARK.length),
      port: url.port,
    };
  } catch {
    return null;
  }
}

/** Absolute base URL (always ending in `/`) that a version's files are served from. */
export function contentBaseUrl(
  config: ResolvedConfig,
  slug: string,
  versionNumber: number,
  requestUrl: URL,
): string {
  const pattern = parseTemplate(config.contentOriginTemplate);
  if (pattern) {
    const host = `${pattern.prefix}${contentHostLabel(slug, versionNumber)}${pattern.suffix}`;
    const port = pattern.port ? `:${pattern.port}` : '';
    return `${pattern.protocol}//${host}${port}/`;
  }
  // Fallback for deployments without wildcard DNS: a path mount on the API
  // origin. Still sandboxed, but not origin-isolated.
  return `${requestUrl.origin}/content/${slug}/${versionNumber}/`;
}

/** Resolves an incoming request host back to a preview version, if it is a content host. */
export function matchContentHost(config: ResolvedConfig, requestUrl: URL): ContentLocation | null {
  const pattern = parseTemplate(config.contentOriginTemplate);
  if (!pattern) return null;
  const hostname = requestUrl.hostname.toLowerCase();
  if (!hostname.startsWith(pattern.prefix) || !hostname.endsWith(pattern.suffix)) return null;
  if (hostname.length <= pattern.prefix.length + pattern.suffix.length) return null;
  return parseContentLabel(
    hostname.slice(pattern.prefix.length, hostname.length - pattern.suffix.length),
  );
}

export function parseContentLabel(label: string): ContentLocation | null {
  const separator = label.lastIndexOf('--');
  if (separator <= 0) return null;
  const slug = label.slice(0, separator);
  const versionNumber = Number.parseInt(label.slice(separator + 2), 10);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
  return { slug, versionNumber };
}
