import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoVideo } from './DemoVideo.js';
import { DEMO_VIDEO_IDS } from '../lib/demoVideo.js';
import { I18nProvider } from '../i18n/index.js';

/*
 * Two guarantees are being held here, and neither is visible by looking at the
 * page. A visitor who has not asked to watch anything is not announced to
 * YouTube — there is no frame at all until the dialog opens. And closing the
 * dialog destroys the player rather than hiding it, which is what actually
 * stops the sound; a version that kept the frame mounted and set `display:
 * none` would look identical and keep talking.
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

/* The dialog renders under document.body, not inside the host element. */
const player = () => document.querySelector<HTMLIFrameElement>('.paper-film__player');
const click = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, `${selector} should be on the page`).not.toBeNull();
  act(() => element!.click());
};

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

describe('the docked demo', () => {
  it('holds no player until someone presses play', () => {
    render();
    expect(document.querySelector('.paper-film__poster')).not.toBeNull();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('opens large, from the nocookie host', () => {
    render();
    click('.paper-film__poster');

    expect(player()).not.toBeNull();
    expect(new URL(player()!.src).hostname).toBe('www.youtube-nocookie.com');
    // Large enough to be worth watching: the dialog, not the corner card.
    expect(player()!.closest('.modal--film')).not.toBeNull();
  });

  it('destroys the player on close, which is what stops the sound', () => {
    render();
    click('.paper-film__poster');
    expect(player()).not.toBeNull();

    click('.paper-film__close');

    expect(player(), 'the frame is gone, not merely hidden').toBeNull();
    // And the corner card is back, ready to open again.
    expect(document.querySelector('.paper-film__poster')).not.toBeNull();
  });

  it('can be reopened after closing', () => {
    render();
    click('.paper-film__poster');
    click('.paper-film__close');
    click('.paper-film__poster');
    expect(player()).not.toBeNull();
  });

  /*
   * The two cuts are separately narrated, so handing a Japanese visitor the
   * English one is the wrong video, not a formatting detail.
   */
  it('plays the cut for the language the page is in', () => {
    localStorage.setItem('liha.locale', 'ja');
    render();
    click('.paper-film__poster');

    expect(player()!.src).toContain(DEMO_VIDEO_IDS.ja);
    expect(player()!.src).not.toContain(DEMO_VIDEO_IDS.en);
  });
});

describe('with no video published for a language', () => {
  it('renders nothing rather than a broken card', async () => {
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
