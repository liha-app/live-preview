/** Process and REST helpers for scripts/deploy.mjs. */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRANGLER = path.join(ROOT, 'apps', 'api', 'node_modules', '.bin', 'wrangler');

/**
 * Runs a command.
 *
 * `capture` returns stdout instead of streaming it, for the handful of places
 * where we parse output. `silentStdin` detaches stdin, which is how wrangler is
 * told to take the non-interactive path on commands that would otherwise
 * prompt. `input` writes to stdin and closes it, which is how a secret reaches
 * `wrangler secret put` without ever being an argv entry other processes could
 * read.
 */
export function run(command, args, options = {}) {
  const {
    cwd = ROOT,
    env = {},
    capture = false,
    silentStdin = false,
    allowFailure = false,
    input,
  } = options;

  return new Promise((resolve, reject) => {
    const stdin = input != null ? 'pipe' : silentStdin ? 'ignore' : 'inherit';
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: [stdin, capture ? 'pipe' : 'inherit', 'pipe'],
    });

    if (input != null) child.stdin.end(input);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (!capture) process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) return resolve({ code, stdout, stderr });
      reject(
        new Error(`${path.basename(command)} ${args[0] ?? ''} exited with ${code}\n${stderr}`),
      );
    });
  });
}

export const wrangler = (args, options) => run(WRANGLER, args, options);

/** Wrangler prints human-readable text around its JSON; take the JSON. */
export function parseJsonOutput(stdout) {
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON in output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

/**
 * The Cloudflare REST API.
 *
 * Only the parts wrangler has no command for: zones, DNS records and Pages
 * custom domains. The token is held in a private field and never logged,
 * serialised, or written to disk.
 */
export class CloudflareApi {
  #token;

  constructor(token) {
    this.#token = token;
  }

  async request(method, endpoint, body) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => null);
    if (!payload?.success) {
      const reason =
        payload?.errors?.map((error) => `${error.message} (${error.code})`).join('; ') ??
        `HTTP ${response.status}`;
      throw new Error(`${method} ${endpoint}: ${reason}`);
    }
    return payload.result;
  }

  /** Returns the token's own permissions record, or throws if it is invalid. */
  verify() {
    return this.request('GET', '/user/tokens/verify');
  }

  accounts() {
    return this.request('GET', '/accounts?per_page=50');
  }

  zones() {
    return this.request('GET', '/zones?per_page=50');
  }

  async zone(name) {
    const zones = await this.request('GET', `/zones?name=${encodeURIComponent(name)}`);
    return zones[0] ?? null;
  }

  /**
   * Creates or updates one DNS record, matching on type and name so that
   * re-running a deployment is a no-op rather than a duplicate.
   */
  async upsertDnsRecord(zoneId, record) {
    const query = `type=${record.type}&name=${encodeURIComponent(record.name)}`;
    const [existing] = await this.request('GET', `/zones/${zoneId}/dns_records?${query}`);
    if (!existing) {
      await this.request('POST', `/zones/${zoneId}/dns_records`, record);
      return 'created';
    }
    if (existing.content === record.content && existing.proxied === record.proxied) {
      return 'unchanged';
    }
    await this.request('PATCH', `/zones/${zoneId}/dns_records/${existing.id}`, record);
    return 'updated';
  }

  async pagesDomains(accountId, project) {
    return this.request('GET', `/accounts/${accountId}/pages/projects/${project}/domains`);
  }

  async addPagesDomain(accountId, project, name) {
    return this.request('POST', `/accounts/${accountId}/pages/projects/${project}/domains`, {
      name,
    });
  }
}
