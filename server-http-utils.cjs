'use strict';

/**
 * Pure HTTP primitives extracted from server.cjs so the test suite can exercise
 * the REAL logic without booting the server (audit RT-04 / RT-05, run
 * AUDIT-RUN-20260919-001828-7455).
 *
 * No I/O, no server state — plain functions only. server.cjs requires this
 * module; tests import the same module, so the tests and the server can no
 * longer drift.
 */

/**
 * Parses a Range header against a file size, with the exact semantics of the
 * /api/video handler this was extracted from (server.cjs):
 *
 *   - accepts "bytes=start-end" and the open-ended "bytes=start-"
 *   - NaN start, NaN end, negative start, end < start, start >= fileSize
 *     are all invalid (the caller answers 416)
 *   - end is clamped to fileSize - 1
 *
 * Returns { invalid: true } or { start, end, contentLength }.
 */
function parseRange(rangeHeader, fileSize) {
  const parts = String(rangeHeader || '').replace(/bytes=/, '').split('-');
  const rawStart = parseInt(parts[0], 10);
  const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(rawStart) || isNaN(rawEnd) || rawStart < 0 || rawEnd < rawStart || rawStart >= fileSize) {
    return { invalid: true };
  }

  const end = Math.min(rawEnd, fileSize - 1);
  return {
    start: rawStart,
    end: end,
    contentLength: end - rawStart + 1,
  };
}

/**
 * Cache-Control policy for static files, extracted verbatim from the
 * express.static setHeaders handler in server.cjs:
 *
 *   - immutable forever for hashed /assets/*.js|.css bundles
 *   - immutable forever for the self-hosted /fonts/*.woff2 files (F-F-06). They
 *     are not content-hashed; their names carry the font version instead
 *     (inter-v20-latin.woff2), so a replacement font must get a new name.
 *     Without this every page view revalidated the preloaded font.
 *   - no-cache, no-transform for every HTML page — a deploy must never leave a
 *     stale SPA shell behind (the "no-transform" part is Cloudflare-specific
 *     and was the live drift the RT-05 tautological test masked)
 *   - null for everything else (favicon, images, …): express.static defaults
 *
 * `filePath` is the ABSOLUTE path express.static hands to setHeaders, and the
 * /assets/ check intentionally runs against that full path — keep it that way
 * or hashed bundles stop being immutable.
 */
function getStaticCacheHeaders(filePath) {
  if (filePath.includes('/assets/') && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
    return 'public, max-age=31536000, immutable';
  }
  if (filePath.includes('/fonts/') && filePath.endsWith('.woff2')) {
    return 'public, max-age=31536000, immutable';
  }
  if (filePath.endsWith('.html')) {
    return 'no-cache, no-transform';
  }
  return null;
}

module.exports = {
  parseRange,
  getStaticCacheHeaders,
};
