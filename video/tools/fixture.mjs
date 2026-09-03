/*
 * The preview the video is shot against.
 *
 * A real upload to the real deployment, with the reviewer's own comments left
 * through the real API — the same calls the web app makes. Nothing here is
 * staged in the database; it is the product being used, ahead of the camera,
 * so the take does not spend twenty seconds on typing that is not the point.
 */
const API = process.env.LIHA_API_URL ?? 'https://api-livepreview.liha.dev';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (outputIndex >= 0 && !outputPath) throw new Error('--output requires a path');

const SITE = {
  'index.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Northwind — ship faster</title>
<link rel="stylesheet" href="/assets/site.css"></head>
<body>
  <header class="nav"><span class="brand">northwind</span>
    <nav><a href="#">Product</a><a href="#">Pricing</a><a href="#">Docs</a></nav></header>
  <main>
    <h1>Ship faster,<br>review together</h1>
    <p class="lede">Everything your team builds, at one link that never changes.</p>
    <button id="cta" class="cta">Get started now</button>
    <section class="cards">
      <article><h3>Preview</h3><p>A stable URL for every build you publish.</p></article>
      <article><h3>Review</h3><p>Comments anchored to the element they are about.</p></article>
      <article><h3>Resolve</h3><p>Agents read the feedback and ship the fix.</p></article>
    </section>
  </main>
</body></html>`,
  'assets/site.css': `:root{--ink:#14161a;--muted:#5c636e;--line:#e6e8ec}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink)}
.nav{display:flex;align-items:center;justify-content:space-between;padding:22px 56px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:19px}
.nav nav a{margin-left:26px;color:var(--muted);text-decoration:none;font-size:15px}
main{max-width:960px;margin:0 auto;padding:72px 56px 96px}
h1{font-size:56px;line-height:1.1;letter-spacing:-.02em;margin:0 0 18px}
.lede{font-size:19px;color:var(--muted);margin:0 0 40px}
.cta{padding:26px 52px;font-size:26px;font-weight:600;color:#fff;background:#14161a;border:0;border-radius:10px;cursor:pointer}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:64px}
.cards article{border:1px solid var(--line);border-radius:12px;padding:22px}
.cards h3{margin:0 0 8px;font-size:17px}
.cards p{margin:0;color:var(--muted);font-size:14.5px}`,
};

/*
 * No spoofed client header. `cf-connecting-ip` is Cloudflare's to set, and a
 * caller that names it is a caller Cloudflare blocks — which is what happened
 * the first time this ran.
 */
const client = () => ({});

async function publish() {
  const form = new FormData();
  form.append('title', 'Northwind landing page');
  for (const body of Object.values(SITE)) form.append('files', new File([body], 'f'));
  form.append('paths', JSON.stringify(Object.keys(SITE)));

  const response = await fetch(`${API}/api/previews`, {
    method: 'POST',
    headers: client(),
    body: form,
  });
  if (!response.ok) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function comment(slug, body) {
  const response = await fetch(`${API}/api/previews/${slug}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...client() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`comment failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const created = await publish();
const { slug } = created.preview;

await comment(slug, {
  authorName: 'Mika (product)',
  body: 'This button is far too large — it takes attention off the headline. Bring it down to about 16px padding and 16px type.',
  target: {
    element: {
      selector: '#cta',
      tagName: 'BUTTON',
      textContent: 'Get started now',
      htmlSnippet: '<button id="cta" class="cta">Get started now</button>',
    },
    viewport: { width: 1280, height: 800 },
  },
});

const fixture = JSON.stringify(
  {
    slug,
    previewId: created.preview.id,
    ownerToken: created.ownerToken,
    shareUrl: created.preview.shareUrl,
    ownerUrl: created.ownerUrl,
    contentUrl: created.preview.contentUrl,
  },
  null,
  2,
);

if (outputPath) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${fixture}\n`, { mode: 0o600 });
  console.log(`Wrote fixture to ${outputPath}`);
} else {
  console.log(fixture);
}
