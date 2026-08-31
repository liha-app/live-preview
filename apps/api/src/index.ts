import { assertProductionConfig, type Env } from './env.js';
import { handleRequest } from './app.js';

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
};
