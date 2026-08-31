import type { LihaWebMcpHost } from './host.js';
import { buildTools } from './tools.js';
import {
  findModelContext,
  type ModelContextTarget,
  type ToolDescriptor,
  type ToolRegistration,
} from './types.js';

export interface RegistrationHandle {
  /** Names actually registered. Empty when the browser has no WebMCP support. */
  readonly toolNames: string[];
  readonly available: boolean;
  /** Which global carried the API, and how tools were handed over. */
  readonly detected: { source: string; style: string } | null;
  unregister(): void;
}

const NOOP_HANDLE: RegistrationHandle = {
  toolNames: [],
  available: false,
  detected: null,
  unregister() {},
};

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown>)?.then === 'function';
}

/**
 * Registers Liha's review tools with whatever WebMCP implementation the browser
 * provides.
 *
 * Feature-detected: when no `modelContext` is present the call is a no-op and
 * the app behaves exactly as it does today. Beyond that, the specification is
 * still in motion, so every teardown mechanism seen in the wild is supported —
 * an `AbortController` signal, a returned handle with `unregister()`, and
 * `unregisterTool(name)` — and a `provideContext({ tools })` implementation is
 * used when incremental registration is unavailable.
 *
 * Tool executions are wrapped so a thrown error becomes an MCP error result
 * rather than an unhandled rejection inside the browser's agent runtime.
 */
export function registerLihaTools(host: LihaWebMcpHost, target?: Document): RegistrationHandle {
  const found = findModelContext(target);
  if (!found) return NOOP_HANDLE;

  const guarded = buildTools(host).map((descriptor) => guard(host, descriptor));
  const detected = { source: found.source, style: found.style };

  return found.style === 'provideContext'
    ? provideAll(found, guarded, detected)
    : registerEach(found, guarded, detected);
}

function guard(host: LihaWebMcpHost, descriptor: ToolDescriptor): ToolDescriptor {
  return {
    ...descriptor,
    async execute(args) {
      try {
        return await descriptor.execute(args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.onToolCall?.({ name: descriptor.name, ok: false, summary: message });
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  };
}

/** Declarative implementations take the whole set at once. */
function provideAll(
  found: ModelContextTarget,
  tools: ToolDescriptor[],
  detected: { source: string; style: string },
): RegistrationHandle {
  try {
    void found.context.provideContext?.({ tools });
  } catch (error) {
    console.warn('[liha] could not provide WebMCP tools', error);
    return NOOP_HANDLE;
  }
  return {
    toolNames: tools.map((tool) => tool.name),
    available: true,
    detected,
    unregister() {
      try {
        void found.context.provideContext?.({ tools: [] });
      } catch {
        /* the page is going away anyway */
      }
    },
  };
}

/** Imperative implementations take one tool at a time. */
function registerEach(
  found: ModelContextTarget,
  tools: ToolDescriptor[],
  detected: { source: string; style: string },
): RegistrationHandle {
  // A single controller aborts every registration at once, which is how the
  // Chrome prototype expects tools to be withdrawn.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const disposers: (() => void)[] = [];
  const toolNames: string[] = [];

  for (const descriptor of tools) {
    try {
      const result = controller
        ? found.context.registerTool?.(descriptor, { signal: controller.signal })
        : found.context.registerTool?.(descriptor);

      if (isPromise(result)) {
        // Some implementations resolve to the handle; a rejection here would
        // otherwise surface as an unhandled promise rejection.
        result.then(
          (resolved) => {
            const handle = resolved as ToolRegistration | undefined;
            if (typeof handle?.unregister === 'function') {
              disposers.push(() => handle.unregister?.());
            }
          },
          (error: unknown) => {
            console.warn(`[liha] WebMCP rejected tool "${descriptor.name}"`, error);
          },
        );
      } else if (typeof (result as ToolRegistration | undefined)?.unregister === 'function') {
        disposers.push(() => (result as ToolRegistration).unregister?.());
      } else if (typeof found.context.unregisterTool === 'function') {
        disposers.push(() => found.context.unregisterTool?.(descriptor.name));
      }
      toolNames.push(descriptor.name);
    } catch (error) {
      console.warn(`[liha] could not register WebMCP tool "${descriptor.name}"`, error);
    }
  }

  return {
    toolNames,
    available: toolNames.length > 0,
    detected,
    unregister() {
      controller?.abort();
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          /* the page is going away anyway */
        }
      }
    },
  };
}
