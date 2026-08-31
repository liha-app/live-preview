/**
 * Minimal typings for the WebMCP API.
 *
 * These are declared locally rather than imported so the package builds in any
 * TypeScript project, and so the runtime feature detection stays honest: the
 * API is genuinely optional and the app must work without it.
 *
 * The specification is still moving. Rather than betting on one shape, this
 * models every form seen in the wild and probes for them at runtime:
 *
 *  - `document.modelContext` (what ChatGPT's in-app browser exposes)
 *  - `navigator.modelContext` (the W3C explainer and Chrome's prototype)
 *  - `registerTool(descriptor)` returning a handle, a promise, or nothing
 *  - `registerTool(descriptor, { signal })` unregistering via AbortController
 *  - `provideContext({ tools })` declaring the whole set at once
 *
 * Guessing wrong here means zero tools register and nothing reports it, so the
 * cost of supporting all of them is far lower than the cost of being wrong.
 */

export interface ToolAnnotations {
  /** The tool does not modify anything. */
  readOnlyHint?: boolean;
  /** The tool can destroy or overwrite data. */
  destructiveHint?: boolean;
  /** Calling it twice with the same arguments has the same effect as once. */
  idempotentHint?: boolean;
  /** The tool reaches systems outside this page. */
  openWorldHint?: boolean;
  /**
   * The result contains data written by other people. Agents must treat it as
   * information to reason about, never as instructions to follow.
   */
  untrustedContentHint?: boolean;
  title?: string;
}

export interface ToolResultContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolResultContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

export interface ToolRegistration {
  unregister?(): void;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
}

export interface ModelContext {
  registerTool?(
    descriptor: ToolDescriptor,
    options?: RegisterToolOptions,
  ): ToolRegistration | Promise<ToolRegistration | void> | void;
  unregisterTool?(name: string): void;
  provideContext?(context: { tools: ToolDescriptor[] }): void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

/** Where the API was found, and how tools will be handed over. */
export interface ModelContextTarget {
  context: ModelContext;
  /** Which global carried it — useful when diagnosing a browser. */
  source: 'document' | 'navigator' | 'global';
  /** Whether tools are registered one at a time or declared as a set. */
  style: 'registerTool' | 'provideContext';
}

function usable(context: ModelContext | undefined): boolean {
  return Boolean(
    context &&
    (typeof context.registerTool === 'function' || typeof context.provideContext === 'function'),
  );
}

/**
 * Finds the WebMCP entry point, wherever this browser happens to put it.
 *
 * `target` is accepted for testing; production always probes the real globals.
 */
export function findModelContext(target?: Document): ModelContextTarget | null {
  const doc = target ?? (typeof document === 'undefined' ? undefined : document);
  const nav =
    target === undefined && typeof navigator !== 'undefined'
      ? (navigator as Navigator)
      : ((target as unknown as { navigator?: Navigator })?.navigator ?? undefined);
  const glob = target === undefined ? (globalThis as { modelContext?: ModelContext }) : undefined;

  const candidates: [ModelContext | undefined, ModelContextTarget['source']][] = [
    [doc?.modelContext, 'document'],
    [nav?.modelContext, 'navigator'],
    [glob?.modelContext, 'global'],
  ];

  for (const [context, source] of candidates) {
    if (!usable(context)) continue;
    return {
      context: context!,
      source,
      style: typeof context!.registerTool === 'function' ? 'registerTool' : 'provideContext',
    };
  }
  return null;
}

/** Backwards-compatible accessor. Prefer {@link findModelContext}. */
export function getModelContext(target?: Document): ModelContext | null {
  return findModelContext(target)?.context ?? null;
}

/** True when this browser exposes WebMCP in any of its known shapes. */
export function isWebMcpAvailable(target?: Document): boolean {
  return findModelContext(target) !== null;
}
