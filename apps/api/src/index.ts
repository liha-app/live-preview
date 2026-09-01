import { assertProductionConfig, type Env } from './env.js';
import { handleRequest, sweepExpired } from './app.js';

export type { Env };

let warned = false;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!warned) {
      warned = true;
      for (const warning of assertProductionConfig(env)) {
        console.warn(`[liha] ${warning}`);
      }
    }
    return handleRequest(request, env);
  },

  /**
   * Retention. Samples are minted per visitor and expire; uploads do not.
   *
   * On a schedule rather than opportunistically on a request, because an expiry
   * that only fires while the site is busy is not an expiry — and because
   * deleting somebody's storage is not work to do inside somebody else's page
   * load.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await sweepExpired(env);
  },
};
