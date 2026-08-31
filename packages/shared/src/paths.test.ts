import { describe, expect, it } from 'vitest';
import {
  PathValidationError,
  decodeAndSanitizePath,
  isSafeRelativePath,
  sanitizeRelativePath,
  stripCommonPrefix,
  versionFileKey,
} from './paths.js';

const TRAVERSAL = [
  '../secrets.txt',
  'a/../../b',
  '/etc/passwd',
  'foo/../../../etc/passwd',
  '..',
  '../',
  'C:/Windows/system32',
  'c:\\windows\\system32',
  '\\\\server\\share\\file',
  'dir\\file.txt',
  'a/b/../../../c',
];

describe('sanitizeRelativePath', () => {
  it('rejects every traversal shape', () => {
    for (const path of TRAVERSAL) {
      expect(() => sanitizeRelativePath(path), path).toThrow(PathValidationError);
      expect(isSafeRelativePath(path), path).toBe(false);
    }
  });

  it('rejects control characters and empty paths', () => {
    expect(() => sanitizeRelativePath(`a${String.fromCharCode(0)}b`)).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath(`a${String.fromCharCode(10)}b`)).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath('')).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath('.')).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath('///')).toThrow(PathValidationError);
  });

  it('rejects oversized paths and segments', () => {
    expect(() => sanitizeRelativePath('a'.repeat(2000))).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath(`dir/${'a'.repeat(300)}`)).toThrow(PathValidationError);
  });

  it('refuses sensitive segments anywhere in the path', () => {
    expect(() => sanitizeRelativePath('.git/config')).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath('dist/.env')).toThrow(PathValidationError);
    expect(() => sanitizeRelativePath('__MACOSX/._x')).toThrow(PathValidationError);
  });

  it('normalizes safe paths without mangling them', () => {
    expect(sanitizeRelativePath('index.html')).toBe('index.html');
    expect(sanitizeRelativePath('./assets/app.js')).toBe('assets/app.js');
    expect(sanitizeRelativePath('a//b///c.css')).toBe('a/b/c.css');
    expect(sanitizeRelativePath('a/./b.png')).toBe('a/b.png');
    expect(sanitizeRelativePath('spaces and (parens).png')).toBe('spaces and (parens).png');
    expect(sanitizeRelativePath('日本語/ファイル.html')).toBe('日本語/ファイル.html');
  });
});

describe('decodeAndSanitizePath', () => {
  it('blocks percent-encoded traversal', () => {
    for (const path of ['..%2Fsecret', '%2e%2e/secret', '%2e%2e%2fsecret', '..%5Csecret']) {
      expect(() => decodeAndSanitizePath(path), path).toThrow(PathValidationError);
    }
  });

  it('blocks double-encoded traversal', () => {
    expect(() => decodeAndSanitizePath('%252e%252e%252fsecret')).toThrow(PathValidationError);
  });

  it('rejects malformed encoding', () => {
    expect(() => decodeAndSanitizePath('%ZZ')).toThrow(PathValidationError);
  });

  it('decodes ordinary encoded names', () => {
    expect(decodeAndSanitizePath('assets/my%20file.png')).toBe('assets/my file.png');
  });
});

describe('versionFileKey', () => {
  it('confines every object under the version prefix', () => {
    expect(versionFileKey('pv_1', 'vr_1', './a/b.html')).toBe(
      'previews/pv_1/versions/vr_1/files/a/b.html',
    );
    expect(() => versionFileKey('pv_1', 'vr_1', '../../other/file')).toThrow(PathValidationError);
  });
});

describe('stripCommonPrefix', () => {
  it('lifts a single wrapping directory to the site root', () => {
    expect(stripCommonPrefix(['dist/index.html', 'dist/assets/a.js'])).toEqual([
      'index.html',
      'assets/a.js',
    ]);
  });

  it('lifts several nested wrapping directories', () => {
    expect(stripCommonPrefix(['a/b/index.html', 'a/b/c/x.js'])).toEqual(['index.html', 'c/x.js']);
  });

  it('leaves already-rooted trees alone', () => {
    expect(stripCommonPrefix(['index.html', 'assets/a.js'])).toEqual(['index.html', 'assets/a.js']);
    expect(stripCommonPrefix(['a/index.html', 'b/x.js'])).toEqual(['a/index.html', 'b/x.js']);
    expect(stripCommonPrefix([])).toEqual([]);
  });
});
