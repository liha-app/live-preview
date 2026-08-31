import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT, injectBridge } from '../src/bridge.js';

const PAGE = `<!doctype html><html><head><title>t</title></head><body>
<main><section class="hero" id="hero">
  <h1>Ship faster</h1>
  <button class="cta primary">Get started</button>
  <button class="cta">Learn more</button>
</section></main>
</body></html>`;

interface Posted {
  source: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Loads a preview page with the bridge injected, standing in for the parent app
 * so the postMessage protocol can be exercised end to end.
 */
function mountPreview(html = PAGE) {
  const posted: Posted[] = [];
  const dom = new JSDOM(injectBridge(html), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://slug--1.preview.test/index.html',
  });
  const { window } = dom;

  // Stand in for the app window that embeds this document.
  const parentWindow = { postMessage: (message: Posted) => posted.push(message) };
  Object.defineProperty(window, 'parent', { value: parentWindow, configurable: true });

  // The inline copy already ran against the real window.parent during parsing;
  // re-run it now that the stand-in parent is in place.
  window.eval(BRIDGE_SCRIPT.replace('if (window.__lihaBridge) return;', ''));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const send = (message: Record<string, unknown>) => {
    const event = new window.MessageEvent('message', { data: { source: 'liha-app', ...message } });
    Object.defineProperty(event, 'source', { value: parentWindow });
    window.dispatchEvent(event);
  };

  return { window, posted, send, document: window.document };
}

describe('injectBridge', () => {
  it('inserts the bridge just before </body>', () => {
    const html = injectBridge('<html><body><p>hi</p></body></html>');
    expect(html).toContain('data-liha-bridge');
    expect(html.indexOf('data-liha-bridge')).toBeLessThan(html.indexOf('</body>'));
  });

  it('handles documents without a body or html tag', () => {
    expect(injectBridge('<p>fragment</p>')).toContain('data-liha-bridge');
    expect(injectBridge('<html><p>x</p></html>')).toContain('data-liha-bridge');
  });

  it('never injects twice', () => {
    const once = injectBridge(PAGE);
    expect(injectBridge(once)).toBe(once);
  });
});

describe('bridge protocol', () => {
  it('announces itself with page metrics', () => {
    const { posted } = mountPreview();
    const ready = posted.find((message) => message.type === 'ready');
    expect(ready?.source).toBe('liha-bridge');
    expect(ready?.metrics).toMatchObject({ path: '/index.html' });
  });

  it('stays inert until the app switches it into review mode', () => {
    const { posted, document } = mountPreview();
    document
      .querySelector('button.cta')!
      .dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    expect(posted.some((message) => message.type === 'element-picked')).toBe(false);
  });

  it('reports the clicked element with a unique selector and DOM context', () => {
    const { posted, send, document, window } = mountPreview();
    send({ type: 'set-mode', mode: 'review' });
    expect(posted.at(-1)).toMatchObject({ type: 'mode-changed', mode: 'review' });

    const target = document.querySelectorAll('button.cta')[1]!;
    target.dispatchEvent(
      new window.MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 60 }),
    );

    const picked = posted.find((message) => message.type === 'element-picked');
    expect(picked).toBeTruthy();
    const element = picked!.element as {
      selector: string;
      tagName: string;
      textContent: string;
      path: string[];
      classList: string[];
      boundingRect: { width: number };
    };
    expect(element.tagName).toBe('BUTTON');
    expect(element.textContent).toBe('Learn more');
    expect(element.classList).toContain('cta');
    expect(element.path.join(' ')).toContain('section#hero');
    // The selector must actually resolve back to the element that was clicked.
    expect(document.querySelector(element.selector)).toBe(target);
  });

  it('prefers a unique id over a positional selector', () => {
    const { posted, send, document, window } = mountPreview();
    send({ type: 'set-mode', mode: 'review' });
    document
      .querySelector('#hero')!
      .dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    const picked = posted.find((message) => message.type === 'element-picked')!;
    expect((picked.element as { selector: string }).selector).toBe('#hero');
  });

  it('normalizes the click position against the whole document', () => {
    const { posted, send, document, window } = mountPreview();
    send({ type: 'set-mode', mode: 'review' });
    document
      .querySelector('h1')!
      .dispatchEvent(
        new window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 50 }),
      );
    const point = posted.find((m) => m.type === 'element-picked')!.point as {
      x: number;
      y: number;
    };
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(1);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(1);
  });

  it('goes quiet again when review mode is switched off', () => {
    const { posted, send, document, window } = mountPreview();
    send({ type: 'set-mode', mode: 'review' });
    send({ type: 'set-mode', mode: 'browse' });
    document
      .querySelector('h1')!
      .dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    expect(posted.some((message) => message.type === 'element-picked')).toBe(false);
  });

  it('ignores messages that did not come from the embedding app', () => {
    const { posted, window, document } = mountPreview();
    // No `source` matching window.parent: a message from any other frame.
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { source: 'liha-app', type: 'set-mode', mode: 'review' },
      }),
    );
    document
      .querySelector('h1')!
      .dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    expect(posted.some((message) => message.type === 'element-picked')).toBe(false);
  });

  it('swallows the click that follows a pick, so links do not navigate', () => {
    const { send, document, window } = mountPreview();
    send({ type: 'set-mode', mode: 'review' });

    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('button.cta')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('answers a metrics request', () => {
    const { posted, send } = mountPreview();
    send({ type: 'request-metrics' });
    const metrics = posted.at(-1);
    expect(metrics?.type).toBe('metrics');
    expect(metrics?.metrics).toHaveProperty('scrollHeight');
  });

  it('survives a page with no elements to speak of', () => {
    expect(() => mountPreview('<html><body></body></html>')).not.toThrow();
  });
});
