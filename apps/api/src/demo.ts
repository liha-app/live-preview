/**
 * A one-click sample preview.
 *
 * Someone arriving at Liha for the first time — a reviewer sent a link, or a
 * judge with four minutes — should be able to see the whole loop without
 * building anything first. This endpoint mints a real preview from a bundled
 * landing page, seeded with the kind of feedback the product exists to carry,
 * so there is something for an agent to act on the moment the page opens.
 *
 * It is a real preview in every respect: real version, real owner token, real
 * comments. Nothing here is mocked.
 */

const DEMO_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #16181c;
  background: #fff;
  line-height: 1.55;
}
.nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 48px; border-bottom: 1px solid #ececec;
}
.logo { font-weight: 700; letter-spacing: -0.02em; font-size: 15px; }
.nav a { margin-left: 24px; color: #6b7280; text-decoration: none; font-size: 14px; }
.hero { padding: 76px 48px 56px; max-width: 780px; }
h1 { font-size: 46px; line-height: 1.08; letter-spacing: -0.03em; margin: 0 0 16px; }
.sub { color: #6b7280; font-size: 18px; margin: 0 0 34px; max-width: 46ch; }
/* Deliberately oversized: this is what the seeded comment is about. */
.cta {
  background: #111; color: #fff; border: 0; border-radius: 12px;
  padding: 26px 52px; font-size: 23px; font-weight: 600; cursor: pointer;
}
.cards {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 18px; padding: 8px 48px 72px;
}
.card { border: 1px solid #ececec; border-radius: 12px; padding: 20px; }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.card p { margin: 0; color: #6b7280; font-size: 14px; }
footer { padding: 28px 48px 56px; color: #9ca3af; font-size: 13px; border-top: 1px solid #ececec; }
`;

const DEMO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Northwind — ship faster</title>
    <link rel="stylesheet" href="/assets/site.css" />
  </head>
  <body>
    <header class="nav">
      <span class="logo">northwind</span>
      <nav>
        <a href="#product">Product</a>
        <a href="#pricing">Pricing</a>
        <a href="#docs">Docs</a>
      </nav>
    </header>

    <section class="hero">
      <h1>Ship faster,<br />review together</h1>
      <p class="sub">
        Everything your team builds, at one link that never changes.
      </p>
      <button class="cta" id="cta">Get started now</button>
    </section>

    <section class="cards" id="features">
      <div class="card">
        <h3>Preview</h3>
        <p>A stable URL for every build you publish.</p>
      </div>
      <div class="card">
        <h3>Review</h3>
        <p>Comments anchored to the element they are about.</p>
      </div>
      <div class="card">
        <h3>Resolve</h3>
        <p>Agents read the feedback and ship the fix.</p>
      </div>
    </section>

    <footer>This is a sample page inside a Liha preview. Click anything to comment on it.</footer>
  </body>
</html>
`;

export interface DemoFile {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface DemoComment {
  authorName: string;
  body: string;
  /** Replies inherit their parent's target, so they carry none of their own. */
  target?: Record<string, unknown>;
  /** Index into the already-created comments that this replies to, if any. */
  replyToIndex?: number;
}

export const DEMO_TITLE = 'Northwind landing page (sample)';

export function demoFiles(): DemoFile[] {
  const encoder = new TextEncoder();
  return [
    {
      path: 'index.html',
      bytes: encoder.encode(DEMO_HTML),
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'assets/site.css',
      bytes: encoder.encode(DEMO_CSS),
      contentType: 'text/css; charset=utf-8',
    },
  ];
}

/**
 * Seeded so an agent asked "what feedback is open here?" has a real answer
 * immediately: one thread with DOM context and a reply, one with a region
 * annotation. Both point at things genuinely wrong with the page.
 *
 * The normalized coordinates below were measured against the page as it renders
 * inside the review frame, not estimated — a marker that misses what it is
 * pointing at is worse than no marker. Because they are normalized they stay
 * anchored at other viewport sizes.
 */
export function demoComments(): DemoComment[] {
  return [
    {
      authorName: 'Sam (design)',
      body: 'This button is too large — it dominates the hero and pulls attention away from the headline. Can we bring it down to something like 16px vertical padding and 16px type?',
      target: {
        annotation: { type: 'pin', point: { x: 0.062, y: 0.452 } },
        path: '/index.html',
        viewport: { width: 1280, height: 800 },
        element: {
          selector: '#cta',
          tagName: 'BUTTON',
          id: 'cta',
          classList: ['cta'],
          textContent: 'Get started now',
          htmlSnippet: '<button class="cta" id="cta">Get started now</button>',
          path: ['body', 'section.hero', 'button.cta'],
        },
      },
    },
    {
      authorName: 'Mika (product)',
      body: 'Agreed. The headline should be the loudest thing on the page.',
      replyToIndex: 0,
    },
    {
      authorName: 'Sam (design)',
      body: 'At 390px the three feature cards overflow horizontally instead of stacking. They need to become a single column below roughly 720px.',
      target: {
        annotation: { type: 'rect', rect: { x: 0.045, y: 0.522, w: 0.91, h: 0.242 } },
        path: '/index.html',
        viewport: { width: 390, height: 844 },
        element: {
          selector: '#features',
          tagName: 'SECTION',
          id: 'features',
          classList: ['cards'],
          textContent: 'Preview Review Resolve',
          htmlSnippet: '<section class="cards" id="features">…</section>',
          path: ['body', 'section.cards'],
        },
      },
    },
  ];
}
