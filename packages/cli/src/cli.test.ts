import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestServer } from '../../../apps/api/test/harness.js';
import { run } from './cli.js';
import { EXIT } from './output.js';

let server: Awaited<ReturnType<typeof startTestServer>>;
let workDir: string;
let configHome: string;
const originalCwd = process.cwd();

/** Captures the two streams separately: agents parse stdout, humans read stderr. */
function captureStreams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
  return {
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

async function cli(...argv: string[]) {
  const streams = captureStreams();
  try {
    const exitCode = await run([...argv, '--api', server.url]);
    return { exitCode, stdout: streams.stdout(), stderr: streams.stderr() };
  } finally {
    streams.restore();
  }
}

async function cliJson<T = Record<string, unknown>>(...argv: string[]) {
  const result = await cli(...argv, '--json');
  return { ...result, data: JSON.parse(result.stdout) as T };
}

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  process.chdir(originalCwd);
  await server.close();
});

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'liha-cli-'));
  configHome = await mkdtemp(join(tmpdir(), 'liha-cfg-'));
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.LIHA_OWNER_TOKEN;
  delete process.env.LIHA_PREVIEW;

  await mkdir(join(workDir, 'dist', 'assets'), { recursive: true });
  await writeFile(
    join(workDir, 'dist', 'index.html'),
    '<!doctype html><html><body><button class="cta">Get started</button></body></html>',
  );
  await writeFile(join(workDir, 'dist', 'assets', 'app.css'), '.cta{padding:22px}');
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe('upload', () => {
  it('creates a preview, prints machine-readable JSON and links the project', async () => {
    const { exitCode, stdout, stderr, data } = await cliJson('upload', './dist');

    expect(exitCode).toBe(EXIT.ok);
    expect(stderr).toBe('');
    // Exactly one JSON document, nothing else.
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(data).toMatchObject({ ok: true, fileCount: 2 });
    expect(data.slug).toMatch(/^[a-z2-9]{12}$/);
    expect(data.ownerToken).toMatch(/^liha_ot_/);
    expect(data.shareUrl).toContain(`/p/${data.slug as string}`);

    const link = JSON.parse(await readFile(join(workDir, '.liha.json'), 'utf8')) as {
      previewId: string;
      slug: string;
    };
    expect(link.slug).toBe(data.slug);
    // The link file must never contain the owner token.
    expect(JSON.stringify(link)).not.toContain(data.ownerToken as string);
  });

  it('writes progress to stderr and a summary to stdout in human mode', async () => {
    const { exitCode, stdout, stderr } = await cli('upload', './dist');
    expect(exitCode).toBe(EXIT.ok);
    expect(stderr).toContain('Uploading');
    expect(stdout).toContain('Share URL');
    expect(stdout).not.toContain('Uploading');
  });

  it('reports a missing path as a usage error', async () => {
    const { exitCode, stdout } = await cliJson('upload', './nope');
    expect(exitCode).toBe(EXIT.usage);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'missing_path' } });
  });

  it('requires a path', async () => {
    const { exitCode } = await cli('upload');
    expect(exitCode).toBe(EXIT.usage);
  });
});

describe('deploy', () => {
  it('runs the detected build script and publishes the detected output', async () => {
    await writeFile(
      join(workDir, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'node build.mjs' } }),
    );
    await writeFile(
      join(workDir, 'build.mjs'),
      `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', '<html><body>built</body></html>');
console.log('built');`,
    );
    await writeFile(join(workDir, 'pnpm-lock.yaml'), '');

    const { exitCode, data } = await cliJson('deploy', '.');
    expect(exitCode).toBe(EXIT.ok);
    expect(data).toMatchObject({ ok: true, action: 'created' });

    const content = await fetch(`${server.url}/content/${data.slug as string}/1/index.html`).then(
      (response) => response.text(),
    );
    expect(content).toContain('built');
  });

  it('publishes a new version to the same share URL the second time', async () => {
    const first = await cliJson('upload', './dist');
    const second = await cliJson('deploy', '.', '--skip-build', '--output', 'dist');

    expect(second.exitCode).toBe(EXIT.ok);
    expect(second.data).toMatchObject({ ok: true, action: 'updated' });
    expect(second.data.shareUrl).toBe(first.data.shareUrl);
    expect((second.data.version as { number: number }).number).toBe(2);
  });

  it('honours an explicit build command', async () => {
    await writeFile(join(workDir, 'package.json'), JSON.stringify({ name: 'demo' }));
    const { exitCode } = await cliJson(
      'deploy',
      '.',
      '--build-command',
      'node -e "process.exit(0)"',
      '--output',
      'dist',
    );
    expect(exitCode).toBe(EXIT.ok);
  });

  it('fails with a non-zero exit code when the build fails', async () => {
    await writeFile(
      join(workDir, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'node -e "process.exit(3)"' } }),
    );
    await writeFile(join(workDir, 'package-lock.json'), '{}');
    const { exitCode, stdout } = await cliJson('deploy', '.');
    expect(exitCode).toBe(EXIT.error);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'build_failed' } });
  });
});

describe('the review loop', () => {
  it('reads comments as JSON, publishes a fix and resolves them', async () => {
    const created = await cliJson('upload', './dist');
    const slug = created.data.slug as string;

    await fetch(`${server.url}/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authorName: 'Reviewer',
        body: 'Make this button smaller.',
        target: {
          annotation: { type: 'pin', point: { x: 0.5, y: 0.25 } },
          element: { selector: 'button.cta', tagName: 'BUTTON', textContent: 'Get started' },
          path: '/index.html',
        },
      }),
    });

    // 1. The agent reads the feedback, with the DOM context it needs.
    const listed = await cliJson<{
      counts: { open: number };
      comments: {
        id: string;
        body: string;
        status: string;
        target: { selector: string; tagName: string; description: string };
      }[];
    }>('comments');
    expect(listed.exitCode).toBe(EXIT.ok);
    expect(listed.data.counts.open).toBe(1);
    const comment = listed.data.comments[0]!;
    expect(comment.body).toBe('Make this button smaller.');
    expect(comment.target.selector).toBe('button.cta');
    expect(comment.target.tagName).toBe('BUTTON');

    // 2. The agent edits and republishes to the same preview.
    await writeFile(join(workDir, 'dist', 'assets', 'app.css'), '.cta{padding:8px}');
    const updated = await cliJson('update', './dist');
    expect(updated.exitCode).toBe(EXIT.ok);
    expect(updated.data.shareUrl).toBe(created.data.shareUrl);
    expect((updated.data.version as { number: number }).number).toBe(2);

    // 3. The old comment is still there, now flagged as outdated.
    const afterUpdate = await cliJson<{ comments: { outdated: boolean }[] }>('comments');
    expect(afterUpdate.data.comments[0]!.outdated).toBe(true);

    // 4. The agent resolves it.
    const resolved = await cliJson('resolve', comment.id);
    expect(resolved.exitCode).toBe(EXIT.ok);
    expect((resolved.data.resolved as { status: string }[])[0]!.status).toBe('resolved');

    const finalState = await cliJson<{ counts: { open: number; resolved: number } }>('info');
    expect(finalState.data.counts).toMatchObject({ open: 0, resolved: 1 });
  });

  it('filters comments by status', async () => {
    await cliJson('upload', './dist');
    const slug = (await cliJson<{ slug: string }>('info')).data.slug;
    await fetch(`${server.url}/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'open one' }),
    });

    expect((await cliJson<{ comments: unknown[] }>('comments')).data.comments).toHaveLength(1);
    expect(
      (await cliJson<{ comments: unknown[] }>('comments', '--status', 'resolved')).data.comments,
    ).toHaveLength(0);
    expect(
      (await cliJson<{ comments: unknown[] }>('comments', '--all')).data.comments,
    ).toHaveLength(1);

    const bad = await cli('comments', '--status', 'nonsense');
    expect(bad.exitCode).toBe(EXIT.usage);
  });

  it('replies in a thread from the terminal', async () => {
    await cliJson('upload', './dist');
    const slug = (await cliJson<{ slug: string }>('info')).data.slug;
    const posted = (await fetch(`${server.url}/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorName: 'Sam', body: 'Make this smaller.' }),
    }).then((response) => response.json())) as { comment: { id: string } };

    const reply = await cliJson<{ comment: { parentId: string } }>(
      'reply',
      posted.comment.id,
      'Reduced it to 16px in v2.',
    );
    expect(reply.exitCode).toBe(EXIT.ok);
    expect(reply.data.comment.parentId).toBe(posted.comment.id);

    // The thread reads in order, and it is still one piece of feedback.
    const listed = await cliJson<{
      counts: { open: number };
      comments: { authorName: string; parentId: string | null }[];
    }>('comments');
    expect(listed.data.counts.open).toBe(1);
    expect(listed.data.comments.map((comment) => comment.authorName)).toEqual(['Sam', 'AI agent']);
  });

  it('requires both a comment and a body to reply', async () => {
    await cliJson('upload', './dist');
    expect((await cli('reply')).exitCode).toBe(EXIT.usage);
    expect((await cli('reply', 'cm_x')).exitCode).toBe(EXIT.usage);
  });

  it('shows one comment with its full DOM context', async () => {
    await cliJson('upload', './dist');
    const slug = (await cliJson<{ slug: string }>('info')).data.slug;
    const posted = (await fetch(`${server.url}/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'check this',
        target: { element: { selector: 'main > h1', tagName: 'H1', htmlSnippet: '<h1>Hi</h1>' } },
      }),
    }).then((response) => response.json())) as { comment: { id: string } };

    const { data } = await cliJson<{ comment: { target: { element: { htmlSnippet: string } } } }>(
      'comment',
      posted.comment.id,
    );
    expect(data.comment.target.element.htmlSnippet).toBe('<h1>Hi</h1>');
  });

  it('lists and restores versions', async () => {
    await cliJson('upload', './dist');
    await cliJson('update', './dist');

    const versions = await cliJson<{ versions: { number: number; isCurrent: boolean }[] }>(
      'versions',
    );
    expect(versions.data.versions.map((version) => version.number)).toEqual([2, 1]);

    const restored = await cliJson<{ currentVersion: { number: number } }>('use-version', '1');
    expect(restored.data.currentVersion.number).toBe(1);

    const missing = await cli('use-version', '99');
    expect(missing.exitCode).toBe(EXIT.notFound);
  });
});

describe('credentials', () => {
  it('refuses owner actions when no token is stored', async () => {
    const created = await cliJson('upload', './dist');
    // A different working directory with no link and no stored credential.
    const bare = await mkdtemp(join(tmpdir(), 'liha-bare-'));
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'liha-empty-'));
    process.chdir(bare);

    const { exitCode, stdout } = await cliJson(
      'resolve',
      'cm_x',
      '--preview',
      created.data.slug as string,
    );
    expect(exitCode).toBe(EXIT.auth);
    expect(JSON.parse(stdout).error.code).toBe('missing_owner_token');
  });

  it('accepts an owner token from the environment', async () => {
    const created = await cliJson('upload', './dist');
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'liha-empty2-'));
    process.env.LIHA_OWNER_TOKEN = created.data.ownerToken as string;

    const { exitCode } = await cliJson(
      'update',
      './dist',
      '--preview',
      created.data.slug as string,
    );
    expect(exitCode).toBe(EXIT.ok);
  });

  it('stores the owner token outside the project directory', async () => {
    const created = await cliJson('upload', './dist');
    const stored = await readFile(join(configHome, 'liha', 'config.json'), 'utf8');
    expect(stored).toContain(created.data.ownerToken as string);
    expect(await readFile(join(workDir, '.liha.json'), 'utf8')).not.toContain(
      created.data.ownerToken as string,
    );
  });

  it('explains what to do when no preview is selected', async () => {
    const { exitCode, stdout } = await cliJson('comments');
    expect(exitCode).toBe(EXIT.usage);
    expect(JSON.parse(stdout).error.code).toBe('no_preview');
  });
});

describe('argument handling', () => {
  it('reports unknown commands', async () => {
    const { exitCode, stdout } = await cliJson('frobnicate');
    expect(exitCode).toBe(EXIT.usage);
    expect(JSON.parse(stdout).error.code).toBe('unknown_command');
  });

  it('prints help and exits 2 with no arguments', async () => {
    const streams = captureStreams();
    const exitCode = await run([]);
    streams.restore();
    expect(exitCode).toBe(EXIT.usage);
    expect(streams.stdout()).toContain('USAGE');
  });

  it('prints help on demand and exits 0', async () => {
    const { exitCode, stdout } = await cli('help');
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain('liha-preview deploy');
  });

  it('reports the version', async () => {
    const { data } = await cliJson('version');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('surfaces a network failure without a stack trace', async () => {
    const streams = captureStreams();
    const exitCode = await run(['info', '--api', 'http://127.0.0.1:1', '--preview', 'x', '--json']);
    streams.restore();
    expect(exitCode).toBe(EXIT.error);
    expect(JSON.parse(streams.stdout()).error.code).toBe('network_error');
  });
});

/*
 * The default sends somebody's build somewhere. Which somewhere is not
 * something to find out from the share URL once it has already gone.
 */
describe('where a publish is going', () => {
  it('is named before the bytes leave', async () => {
    await writeFile(join(workDir, 'index.html'), '<html><body>hi</body></html>');
    const { exitCode, stderr } = await cli('deploy', '.', '--skip-build');
    expect(exitCode).toBe(EXIT.ok);

    // Before the upload starts, not in the summary afterwards.
    const said = stderr.indexOf(server.url);
    const sending = stderr.indexOf('Creating a preview');
    expect(said, 'the destination should be reported').toBeGreaterThanOrEqual(0);
    expect(sending).toBeGreaterThanOrEqual(0);
    expect(said).toBeLessThan(sending);
  });

  it('defaults to somewhere that exists, not to a local port', async () => {
    const { DEFAULT_API_URL } = await import('@liha-cli/mcp');
    expect(DEFAULT_API_URL).toMatch(/^https:\/\//);
    expect(DEFAULT_API_URL).not.toContain('localhost');
  });
});
