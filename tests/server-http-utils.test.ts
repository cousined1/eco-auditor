/**
 * RT-04 / RT-05 (audit run AUDIT-RUN-20260919-001828-7455) — REAL unit tests
 * for the Range parser and the static Cache-Control policy.
 *
 * The previous tests (tests/server.test.ts "Range Header Validation" /
 * "Cache Headers Logic") reimplemented both helpers in the test file and
 * asserted the local copy — the server could drift (and had: the test
 * expected plain "no-cache" for HTML while the server shipped
 * "no-cache, no-transform") with the suite staying green.
 *
 * server.cjs now requires server-http-utils.cjs (see the /api/video handler
 * and the express.static setHeaders block), and these tests import that SAME
 * module, so they fail on any behavioral drift.
 */
import { describe, it, expect } from 'vitest';
import { parseRange, getStaticCacheHeaders } from '../server-http-utils.cjs';

describe('parseRange (server-http-utils.cjs — used by /api/video)', () => {
  const fileSize = 10000;

  it('parses a valid closed range', () => {
    const result = parseRange('bytes=0-999', fileSize);
    expect(result).toEqual({ start: 0, end: 999, contentLength: 1000 });
  });

  it('parses an open-ended range as "to EOF"', () => {
    const result = parseRange('bytes=500-', fileSize);
    expect(result).toEqual({ start: 500, end: 9999, contentLength: 9500 });
  });

  it('rejects a NaN start', () => {
    expect(parseRange('bytes=abc-999', fileSize)).toEqual({ invalid: true });
  });

  it('rejects a negative start', () => {
    // "bytes=-1-999" splits to ["", "1", "999"] -> start is NaN.
    expect(parseRange('bytes=-1-999', fileSize)).toEqual({ invalid: true });
  });

  it('rejects start > end', () => {
    expect(parseRange('bytes=999-500', fileSize)).toEqual({ invalid: true });
  });

  it('rejects start >= file size', () => {
    expect(parseRange('bytes=10000-10001', fileSize)).toEqual({ invalid: true });
  });

  it('rejects a NaN end', () => {
    expect(parseRange('bytes=0-xyz', fileSize)).toEqual({ invalid: true });
  });

  it('clamps end to file size - 1', () => {
    const result = parseRange('bytes=0-99999', fileSize);
    expect(result).toEqual({ start: 0, end: 9999, contentLength: 10000 });
  });

  it('treats a suffix-style range ("bytes=-500") as invalid, not as a suffix request', () => {
    // The server handler has never supported RFC 7233 suffix ranges; keep the
    // contract explicit so a "helpful" rewrite cannot change it silently.
    expect(parseRange('bytes=-500', fileSize)).toEqual({ invalid: true });
  });

  it('handles empty input defensively', () => {
    expect(parseRange('', fileSize)).toEqual({ invalid: true });
  });
});

describe('getStaticCacheHeaders (server-http-utils.cjs — express.static setHeaders)', () => {
  it('sends immutable caching for hashed JS bundles', () => {
    expect(getStaticCacheHeaders('/repo/static/assets/index-D6gBU1wL.js')).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('sends immutable caching for hashed CSS bundles', () => {
    expect(getStaticCacheHeaders('/repo/static/assets/index-CjmghmtH.css')).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('sends immutable caching for the self-hosted fonts, whose names carry the font version (F-F-06)', () => {
    expect(getStaticCacheHeaders('/repo/static/fonts/inter-v20-latin.woff2')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(getStaticCacheHeaders('/repo/static/fonts/jetbrains-mono-v24-latin.woff2')).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('does not make other files in /fonts/ or a stray .woff2 immutable', () => {
    expect(getStaticCacheHeaders('/repo/static/fonts/OFL-Inter.txt')).toBeNull();
    expect(getStaticCacheHeaders('/repo/static/downloads/report.woff2')).toBeNull();
  });

  it('sends no-cache, no-transform for HTML pages (the value the server actually ships)', () => {
    // The old tautological test asserted plain "no-cache" — the live drift
    // RT-05 documented. The extracted module must keep "no-transform" so a
    // cached SPA shell cannot outlive a deploy.
    expect(getStaticCacheHeaders('/repo/static/index.html')).toBe('no-cache, no-transform');
    expect(getStaticCacheHeaders('/repo/static/pricing/index.html')).toBe('no-cache, no-transform');
  });

  it('returns null for everything else so express.static defaults apply', () => {
    expect(getStaticCacheHeaders('/repo/static/favicon.ico')).toBeNull();
    expect(getStaticCacheHeaders('/repo/static/images/photo.png')).toBeNull();
  });

  it('does not grant immutable to unhashed top-level scripts', () => {
    // Only /assets/ bundles are immutable; a root-level .js must fall through.
    expect(getStaticCacheHeaders('/repo/static/service-worker.js')).toBeNull();
  });
});
