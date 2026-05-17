/**
 * InsForge configuration tests
 * Verifies that the InsForge client handles missing configuration gracefully
 *
 * NOTE: Because Vitest resolves imports at module load time, env stubs
 * applied via vi.stubEnv() before a dynamic import() are respected.
 * We use vi.unstubAllEnvs() (not vi.restoreAllMocks) to properly reset
 * environment variables set by vi.stubEnv().
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('InsForge configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isInsForgeConfigured is false when env vars are missing', async () => {
    vi.stubEnv('VITE_INSFORGE_BASE_URL', '');
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', '');

    const { isInsForgeConfigured } = await import('../src/lib/insforge.ts');
    expect(isInsForgeConfigured).toBe(false);
  });

  it('isInsForgeConfigured is true when env vars are set', async () => {
    vi.stubEnv('VITE_INSFORGE_BASE_URL', 'https://example.insforge.co');
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');

    // Clear any cached module so the dynamic import re-evaluates
    vi.resetModules();
    const { isInsForgeConfigured } = await import('../src/lib/insforge.ts');
    expect(isInsForgeConfigured).toBe(true);
  });

  it('module does not throw at evaluation time when env vars are missing', async () => {
    vi.stubEnv('VITE_INSFORGE_BASE_URL', '');
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', '');

    vi.resetModules();
    // Dynamic import should succeed without throwing
    let module;
    await expect(async () => {
      module = await import('../src/lib/insforge.ts');
    }).resolves.not.toThrow();

    // Should export the flag as false
    expect(module.isInsForgeConfigured).toBe(false);
  });
});