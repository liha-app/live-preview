export type UrlValidationCode =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'blocked_port'
  | 'blocked_credentials'
  | 'blocked_host'
  | 'blocked_address'
  | 'too_many_redirects';

export class UrlValidationError extends Error {
  constructor(
    message: string,
    readonly code: UrlValidationCode,
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

export const ALLOWED_URL_PORTS = new Set(['', '80', '443', '8080', '8443']);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.localdomain',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** RFC 1918 / 5735 / 6598 and friends: anything not routable on the public internet. */
function isPrivateIpv4(octets: number[]): boolean {
  const a = octets[0]!;
  const b = octets[1]!;
  const c = octets[2]!;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function expandIpv6(host: string): number[] | null {
  let text = host;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (!text.includes(':')) return null;

  // An IPv4-mapped tail (::ffff:127.0.0.1) becomes two 16-bit groups.
  const lastColon = text.lastIndexOf(':');
  const v4 = parseIpv4(text.slice(lastColon + 1));
  if (v4) {
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0]!.split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1]!.split(':') : [];
  const groups =
    halves.length === 2
      ? [
          ...head,
          ...new Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'),
          ...tail,
        ]
      : head;
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(Number.parseInt(group, 16));
  }
  return out;
}

function isPrivateIpv6(groups: number[]): boolean {
  const g0 = groups[0]!;
  const g1 = groups[1]!;
  if (groups.slice(0, 7).every((g) => g === 0)) return true; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64
  if (g0 === 0x0100) return true; // discard-only
  if (g0 === 0x2001 && (g1 === 0x0000 || g1 === 0x0db8)) return true; // Teredo, documentation
  if (g0 === 0x2002) {
    // 6to4 embeds an IPv4 address in the next 32 bits.
    const a = groups[1]!;
    const b = groups[2]!;
    return isPrivateIpv4([a >> 8, a & 0xff, b >> 8, b & 0xff]);
  }
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const a = groups[6]!;
    const b = groups[7]!;
    return isPrivateIpv4([a >> 8, a & 0xff, b >> 8, b & 0xff]);
  }
  return false;
}

export interface UrlValidationOptions {
  allowedPorts?: Set<string>;
}

/**
 * Validates a user-supplied URL before the server fetches it.
 *
 * NOTE: this blocks literal private addresses and known-internal hostnames, but
 * it cannot see DNS results. A public hostname that resolves to a private
 * address (DNS rebinding) still needs the egress controls described in
 * docs/security.md.
 */
export function assertPublicHttpUrl(input: string, options: UrlValidationOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlValidationError('Not a valid absolute URL.', 'invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlValidationError(`Scheme "${url.protocol}" is not allowed.`, 'blocked_scheme');
  }
  if (url.username || url.password) {
    throw new UrlValidationError(
      'URLs with embedded credentials are not allowed.',
      'blocked_credentials',
    );
  }

  const allowedPorts = options.allowedPorts ?? ALLOWED_URL_PORTS;
  if (!allowedPorts.has(url.port)) {
    throw new UrlValidationError(`Port "${url.port}" is not allowed.`, 'blocked_port');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname.length === 0) throw new UrlValidationError('Missing hostname.', 'invalid_url');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlValidationError(`Hostname "${hostname}" is not allowed.`, 'blocked_host');
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UrlValidationError(`Hostname "${hostname}" is not allowed.`, 'blocked_host');
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    throw new UrlValidationError(
      `Address "${hostname}" is not publicly routable.`,
      'blocked_address',
    );
  }
  const ipv6 = expandIpv6(url.hostname);
  if (ipv6 && isPrivateIpv6(ipv6)) {
    throw new UrlValidationError(
      `Address "${hostname}" is not publicly routable.`,
      'blocked_address',
    );
  }
  // A bare hostname with no dot is almost always an internal name.
  if (!ipv4 && !ipv6 && !hostname.includes('.')) {
    throw new UrlValidationError(`Hostname "${hostname}" is not fully qualified.`, 'blocked_host');
  }
  return url;
}

export function isPublicHttpUrl(input: string, options?: UrlValidationOptions): boolean {
  try {
    assertPublicHttpUrl(input, options);
    return true;
  } catch {
    return false;
  }
}

export interface SafeFetchOptions extends UrlValidationOptions {
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  init?: RequestInit;
  signal?: AbortSignal | null;
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: URL;
  redirects: string[];
}

/**
 * Fetches a URL while re-validating every redirect hop, because the first URL
 * being public says nothing about where a 302 points.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  const redirects: string[] = [];
  let current = assertPublicHttpUrl(input, options);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await doFetch(current.toString(), {
      ...options.init,
      redirect: 'manual',
      signal: options.signal ?? null,
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = assertPublicHttpUrl(new URL(location, current).toString(), options);
      redirects.push(current.toString());
      continue;
    }
    return { response, finalUrl: current, redirects };
  }
  throw new UrlValidationError('Too many redirects.', 'too_many_redirects');
}
