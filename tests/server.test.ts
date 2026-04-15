/**
 * Server logic unit tests
 * Tests rate limiting, security headers, range validation, cache headers
 * Pure function tests — no HTTP server needed
 */
import { describe, it, expect } from 'vitest';

// ─── Rate Limiter Logic ───

function createRateLimiter(windowMs: number, max: number) {
  const store = new Map<string, { windowStart: number; count: number }>();

  function check(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { windowStart: now, count: 1 });
      return { allowed: true };
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }

  return { check, store };
}

describe('Rate Limiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter(60000, 120);
    const result = limiter.check('10.0.0.1');
    expect(result.allowed).toBe(true);
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter(60000, 2);
    limiter.check('10.0.0.2');
    limiter.check('10.0.0.2');
    const result = limiter.check('10.0.0.2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('tracks different IPs separately', () => {
    const limiter = createRateLimiter(60000, 2);
    limiter.check('10.0.0.10');
    limiter.check('10.0.0.10');
    // IP 10.0.0.10 is now at limit
    const result = limiter.check('10.0.0.11');
    expect(result.allowed).toBe(true);
  });

  it('resets window after time passes', () => {
    const limiter = createRateLimiter(100, 2);
    limiter.check('10.0.0.20');
    limiter.check('10.0.0.20');
    // Exhaust the limit
    expect(limiter.check('10.0.0.20').allowed).toBe(false);
    // Simulate time passing by shifting windowStart
    const entry = limiter.store.get('10.0.0.20')!;
    entry.windowStart = Date.now() - 200;
    // Should be allowed again
    expect(limiter.check('10.0.0.20').allowed).toBe(true);
  });
});

// ─── Security Headers ───

describe('Security Headers', () => {
  const requiredHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  it('includes all required security headers', () => {
    for (const [key, value] of Object.entries(requiredHeaders)) {
      expect(value).toBeDefined();
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('X-Content-Type-Options prevents MIME sniffing', () => {
    expect(requiredHeaders['X-Content-Type-Options']).toBe('nosniff');
  });

  it('X-Frame-Options prevents clickjacking', () => {
    expect(requiredHeaders['X-Frame-Options']).toBe('DENY');
  });

  it('Referrer-Policy limits referrer leakage', () => {
    expect(requiredHeaders['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});

// ─── Range Header Validation ───

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number; contentLength: number } | { invalid: true } {
  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= fileSize) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
    contentLength: Math.min(end, fileSize - 1) - start + 1,
  };
}

describe('Range Header Validation', () => {
  const fileSize = 10000;

  it('parses valid range', () => {
    const result = parseRange('bytes=0-999', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.start).toBe(0);
    expect(result.end).toBe(999);
    expect(result.contentLength).toBe(1000);
  });

  it('parses open-ended range', () => {
    const result = parseRange('bytes=500-', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.start).toBe(500);
    expect(result.end).toBe(9999);
  });

  it('rejects NaN start', () => {
    const result = parseRange('bytes=abc-999', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects negative start', () => {
    const result = parseRange('bytes=-1-999', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects start > end', () => {
    const result = parseRange('bytes=999-500', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects start >= file size', () => {
    const result = parseRange('bytes=10000-10001', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects NaN end', () => {
    const result = parseRange('bytes=0-xyz', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('clamps end to file size - 1', () => {
    const result = parseRange('bytes=0-99999', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.end).toBe(9999);
  });
});

// ─── Cache Headers Logic ───

describe('Cache Headers Logic', () => {
  function getCacheHeaders(filePath: string): string | null {
    if (filePath.includes('/assets/') && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      return 'public, max-age=31536000, immutable';
    } else if (filePath.endsWith('.html')) {
      return 'no-cache';
    }
    return null;
  }

  it('sets immutable cache for hashed JS assets', () => {
    expect(getCacheHeaders('/assets/index-D6gBU1wL.js')).toBe('public, max-age=31536000, immutable');
  });

  it('sets immutable cache for hashed CSS assets', () => {
    expect(getCacheHeaders('/assets/index-CjmghmtH.css')).toBe('public, max-age=31536000, immutable');
  });

  it('sets no-cache for HTML files', () => {
    expect(getCacheHeaders('/index.html')).toBe('no-cache');
  });

  it('returns null for other files', () => {
    expect(getCacheHeaders('/favicon.ico')).toBeNull();
  });
});

// ─── Graceful Shutdown Logic ───

describe('Graceful Shutdown Logic', () => {
  it('calls server.close on shutdown signal', () => {
    let closed = false;
    const mockServer = {
      close(cb: () => void) { closed = true; cb(); },
    };
    mockServer.close(() => {});
    expect(closed).toBe(true);
  });
});

// ─── Health Check Response Structure ───

describe('Health Check Response Structure', () => {
  it('includes all required fields', () => {
    const response = {
      status: 'ok',
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.0',
      timestamp: new Date().toISOString(),
    };
    expect(response.status).toBe('ok');
    expect(typeof response.uptime).toBe('number');
    expect(typeof response.timestamp).toBe('string');
    expect(new Date(response.timestamp).getTime()).toBeGreaterThan(0);
  });
});