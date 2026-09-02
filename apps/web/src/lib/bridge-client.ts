import type { ElementContext, Point } from '@liha-cli/shared';

/** Mirror of the messages emitted by the bridge script injected into previews. */
export interface BridgeMetrics {
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  path: string;
}

export type BridgeMessage =
  | { source: 'liha-bridge'; type: 'ready'; metrics: BridgeMetrics }
  | { source: 'liha-bridge'; type: 'metrics'; metrics: BridgeMetrics }
  | { source: 'liha-bridge'; type: 'mode-changed'; mode: 'review' | 'browse' }
  | {
      source: 'liha-bridge';
      type: 'element-picked';
      element: ElementContext;
      point: Point;
      metrics: BridgeMetrics;
    };

export const DEFAULT_METRICS: BridgeMetrics = {
  scrollX: 0,
  scrollY: 0,
  scrollWidth: 1,
  scrollHeight: 1,
  innerWidth: 1,
  innerHeight: 1,
  devicePixelRatio: 1,
  path: '/',
};

/**
 * Preview content runs in a sandboxed iframe with an opaque origin, so
 * `event.origin` is always "null" and cannot be used for authentication.
 * Identity is established by comparing `event.source` against the exact
 * `contentWindow` we created — which no other document can forge.
 */
export function isBridgeMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
): event is MessageEvent<BridgeMessage> {
  if (!frame || event.source !== frame.contentWindow) return false;
  const data = event.data as { source?: string; type?: string } | null;
  return Boolean(data && data.source === 'liha-bridge' && typeof data.type === 'string');
}

export function postToBridge(
  frame: HTMLIFrameElement | null,
  message: Record<string, unknown>,
): void {
  frame?.contentWindow?.postMessage({ source: 'liha-app', ...message }, '*');
}
