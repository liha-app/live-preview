import type { ResolvedConfig } from './env.js';

export interface ContentLocation {
  slug: string;
  versionNumber: number;
}

/**
 * Builds and reads back the hostnames a preview is served from.
 *
 * Templates name their parts: `{slug}` and `{version}`, or `{label}` for the
 * combined `<slug>--<version>` the first version of this config used. The order
 * is the template's business — `{slug}-lp-v{version}.example.com` and
 * `{label}.example.com` are both fine — because a shared domain may already
 * have a naming convention that this service has to fit into rather than
 * impose.
 *
 * Every preview version gets a distinct hostname, and that is the point. Two
 * consequences matter:
 *  - the browser's same-origin policy keeps uploaded HTML away from the app's
 *    storage, where the owner token lives;
 *  - root-absolute asset paths (`/assets/app.js`, what every bundler emits)
 *    resolve correctly, which a path-prefixed mount cannot do.
 */
export function contentHostLabel(slug: string, versionNumber: number): string {
  return `${slug}--${versionNumber}`;
}

/*
 * Placeholders are swapped for these before the template is parsed as a URL, so
 * a hostname stays a legal hostname while it is being taken apart. They are
 * lowercase letters for the same reason.
 */
const SENTINELS = { slug: 'zzslugzz', version: 'zzversionzz', label: 'zzlabelzz' } as const;
type Part = keyof typeof SENTINELS;

const CAPTURE: Record<Part, string> = {
  slug: '([a-z0-9]+)',
  version: '([0-9]+)',
  label: '([a-z0-9]+)--([0-9]+)',
};

interface HostShape {
  protocol: string;
  port: string;
  /** The template's hostname with sentinels still in it. */
  hostname: string;
  /** Which placeholder each capture group belongs to, in order. */
  parts: Part[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTemplate(template: string | null): HostShape | null {
  if (!template) return null;

  const parts: Part[] = [];
  const sentinelled = template.replace(/\{(slug|version|label)\}/g, (_, name: Part) => {
    parts.push(name);
    return SENTINELS[name];
  });
  if (parts.length === 0) return null;

  try {
    const url = new URL(sentinelled);
    // A placeholder has to land in the hostname. In a path it would give every
    // version the same origin, which is the whole point of this.
    if (!parts.some((part) => url.hostname.includes(SENTINELS[part]))) return null;
    return { protocol: url.protocol, port: url.port, hostname: url.hostname, parts };
  } catch {
    return null;
  }
}

function buildHostname(shape: HostShape, slug: string, versionNumber: number): string {
  return shape.hostname
    .replace(SENTINELS.label, contentHostLabel(slug, versionNumber))
    .replace(SENTINELS.slug, slug)
    .replace(SENTINELS.version, String(versionNumber));
}

/** Absolute base URL (always ending in `/`) that a version's files are served from. */
export function contentBaseUrl(
  config: ResolvedConfig,
  slug: string,
  versionNumber: number,
  requestUrl: URL,
): string {
  const shape = parseTemplate(config.contentOriginTemplate);
  if (shape) {
    const port = shape.port ? `:${shape.port}` : '';
    return `${shape.protocol}//${buildHostname(shape, slug, versionNumber)}${port}/`;
  }
  // Fallback for deployments without wildcard DNS: a path mount on the API
  // origin. Still sandboxed, but not origin-isolated.
  return `${requestUrl.origin}/content/${slug}/${versionNumber}/`;
}

/**
 * Pulls the parts back out of a hostname the template could have produced.
 *
 * The text around the placeholders has to match exactly. On a domain shared
 * with other services, anything this does not recognise must be left alone
 * rather than claimed and 404ed.
 */
function extract(
  template: string | null,
  hostname: string,
): { slug?: string; version?: string } | null {
  const shape = parseTemplate(template);
  if (!shape) return null;

  let pattern = escapeRegex(shape.hostname);
  for (const part of shape.parts) {
    pattern = pattern.replace(escapeRegex(SENTINELS[part]), CAPTURE[part]);
  }

  const found = new RegExp(`^${pattern}$`).exec(hostname.toLowerCase());
  if (!found) return null;

  // `label` contributes two capture groups; the others contribute one each.
  const values: { slug?: string; version?: string } = {};
  let index = 1;
  for (const part of shape.parts) {
    if (part === 'label') {
      values.slug ??= found[index++];
      values.version ??= found[index++];
    } else {
      values[part] ??= found[index++];
    }
  }
  return values;
}

/** Resolves an incoming hostname back to a preview version, if it is one. */
export function matchHostname(template: string | null, hostname: string): ContentLocation | null {
  const values = extract(template, hostname);
  if (!values) return null;

  const versionNumber = Number.parseInt(values.version ?? '', 10);
  if (!values.slug || !Number.isInteger(versionNumber) || versionNumber < 1) return null;
  return { slug: values.slug, versionNumber };
}

/**
 * Resolves an incoming hostname to the preview whose review screen it is.
 *
 * The review screen and the artifact live on sibling hostnames — one level
 * under the same apex, so a single wildcard certificate covers both — but they
 * are different origins, which is what keeps uploaded HTML away from the owner
 * token in the app's storage.
 */
export function matchReviewHost(template: string | null, hostname: string): string | null {
  const values = extract(template, hostname);
  return values?.slug && !values.version ? values.slug : null;
}

/**
 * The wildcard form of a template's hostname, for a Content-Security-Policy.
 *
 * `https://{slug}-lp-v{version}.liha.review` becomes `https://*.liha.review`.
 * Returns null when the varying part is not confined to the first label, since
 * a policy cannot express a wildcard anywhere else.
 */
export function originWildcard(template: string | null): string | null {
  const shape = parseTemplate(template);
  if (!shape) return null;

  const dot = shape.hostname.indexOf('.');
  if (dot === -1) return null;
  const first = shape.hostname.slice(0, dot);
  const rest = shape.hostname.slice(dot + 1);
  const varies = shape.parts.some((part) => first.includes(SENTINELS[part]));
  if (!varies || shape.parts.some((part) => rest.includes(SENTINELS[part]))) return null;

  const port = shape.port ? `:${shape.port}` : '';
  return `${shape.protocol}//*.${rest}${port}`;
}

/** Resolves an incoming request host back to a preview version, if it is one. */
export function matchContentHost(config: ResolvedConfig, requestUrl: URL): ContentLocation | null {
  return matchHostname(config.contentOriginTemplate, requestUrl.hostname);
}

export function parseContentLabel(label: string): ContentLocation | null {
  const separator = label.lastIndexOf('--');
  if (separator <= 0) return null;
  const slug = label.slice(0, separator);
  const versionNumber = Number.parseInt(label.slice(separator + 2), 10);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
  return { slug, versionNumber };
}
