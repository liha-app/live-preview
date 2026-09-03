import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoVideo } from './DemoVideo.js';
import { DEMO_VIDEO_IDS } from '../lib/demoVideo.js';
import { I18nProvider } from '../i18n/index.js';

/*
 * The point of this component is what it does *not* do: while nobody has asked
 * to watch the video, the page must hold no YouTube frame at all. A future
 * simplification into a plain `<iframe src=…>` would look identical on screen
 * and quietly start sending every visitor to YouTube, so the absence is what
 * these tests assert.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <I18nProvider>
        <DemoVideo />
      </I18nProvider>,
    );
  });
  return host;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('the demo video card', () => {
  it('holds no frame until someone presses play', () => {
    const el = render();
    expect(el.querySelector('.paper-film')).not.toBeNull();
    expect(el.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('loads the nocookie player only after the click', () => {
    const el = render();
    const play = el.querySelector<HTMLButtonElement>('.paper-film__poster');
    expect(play, 'the poster should be a real button').not.toBeNull();

    act(() => play!.click());

    const frame = el.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(new URL(frame!.src).hostname).toBe('www.youtube-nocookie.com');
  });

  /*
   * The two cuts are separately narrated, so handing a Japanese visitor the
   * English one is the wrong video, not a formatting detail.
   */
  it('offers the cut for the language the page is in', () => {
    localStorage.setItem('liha.locale', 'ja');
    const el = render();
    const link = el.querySelector<HTMLAnchorElement>('.paper-film__note a');
    expect(link!.href).toContain(DEMO_VIDEO_IDS.ja);
    expect(link!.href).not.toContain(DEMO_VIDEO_IDS.en);
  });
});

describe('with no video published for a language', () => {
  it('renders nothing rather than a broken player', async () => {
    vi.resetModules();
    vi.doMock('../lib/demoVideo.js', async () => {
      const real =
        await vi.importActual<typeof import('../lib/demoVideo.js')>('../lib/demoVideo.js');
      return { ...real, demoVideoId: () => '' };
    });
    const { DemoVideo: Empty } = await import('./DemoVideo.js');
    // `resetModules` gives the re-imported component a fresh copy of the i18n
    // module, and with it a fresh context object. The provider has to come from
    // that same copy or the component cannot see it.
    const { I18nProvider: Provider } = await import('../i18n/index.js');

    const el = document.createElement('div');
    document.body.append(el);
    const r = createRoot(el);
    act(() => {
      r.render(
        <Provider>
          <Empty />
        </Provider>,
      );
    });
    expect(el.textContent).toBe('');
    act(() => r.unmount());
    el.remove();
  });
});
