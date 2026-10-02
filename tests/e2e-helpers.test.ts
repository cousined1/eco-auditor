/**
 * F-R4-02 — the spawn/Docker helpers must be hermetic. Before, spawned servers
 * inherited the whole shell environment (a developer's SITE_DEPLOY_TOKEN,
 * ALLOW_SAMPLE_DATA or DEV_COMPANY_ID changed what they did), and suites used
 * fixed container names and ports, so two runs removed each other's
 * containers. No Docker needed for these checks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { e2eEnv, freePort, uniqueContainerName } from './e2e-helpers';

const PLANTED = ['SITE_DEPLOY_TOKEN', 'ALLOW_SAMPLE_DATA', 'DEV_COMPANY_ID', 'RAILWAY_GIT_COMMIT_SHA', 'INSFORGE_ANON_KEY'];
const saved = new Map<string, string | undefined>();

describe('F-R4-02 — tests/e2e-helpers.ts is hermetic', () => {
  beforeEach(() => {
    for (const key of PLANTED) saved.set(key, process.env[key]);
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('a spawned server env carries explicit settings and OS basics, never ambient variables', () => {
    for (const key of PLANTED) process.env[key] = 'hostile-ambient-value';
    const env = e2eEnv({ SITE_DEPLOY_TOKEN: 'explicit' });
    expect(env.SITE_DEPLOY_TOKEN).toBe('explicit');
    for (const key of PLANTED.filter((k) => k !== 'SITE_DEPLOY_TOKEN')) {
      expect({ key, value: env[key] }).toEqual({ key, value: undefined });
    }
    expect(Object.values(env)).not.toContain('hostile-ambient-value');
    expect(env.NODE_ENV).toBe('development');
    expect(Object.keys(env).some((key) => key.toUpperCase() === 'PATH')).toBe(true);
  });

  it('container names are unique per call, keep the suite prefix, and are valid Docker names', () => {
    const first = uniqueContainerName('fix-tests-pg');
    const second = uniqueContainerName('fix-tests-pg');
    expect(first).not.toBe(second);
    expect(first.startsWith(`fix-tests-pg-${process.pid}-`)).toBe(true);
    expect(first).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/);
  });

  it('freePort returns a port that can be bound on the wildcard address server.cjs uses', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => resolve());
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
