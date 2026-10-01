// F-B-19: a failed code-chunk load (offline, or any tab left open across a
// deploy) replaced the whole app with "Something went wrong" until reload.
import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, loadWithRecovery, type ChunkRecoveryEnv } from '../src/lib/chunkRecovery';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://ecoauditor.example/assets/DataIntake-DCvs-0VE.js');

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const MARK = 'eco-auditor:chunk-reload:DataIntake';

function setup(overrides: Partial<ChunkRecoveryEnv> = {}) {
  const storage = memoryStorage();
  const reload = vi.fn();
  const env: ChunkRecoveryEnv = { storage, isOffline: () => false, reload, ...overrides };
  return { storage, reload, env };
}

// A promise that has not settled after a generous tick is, for these tests, pending.
async function settlement(promise: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
  ]);
}

describe('isChunkLoadError', () => {
  it.each([
    ['Chrome / Edge', new TypeError('Failed to fetch dynamically imported module: https://x/assets/A.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://x/assets/A.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['Vite CSS preload', new Error('Unable to preload CSS for /assets/Dashboard-abc.css')],
    ['webpack', new Error('Loading chunk 12 failed.')],
    ['webpack CSS', new Error('Loading CSS chunk 7 failed.')],
  ])('recognises the %s message', (_browser, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('recognises the ChunkLoadError name and a bare string', () => {
    const named = new Error('nope');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /a.js')).toBe(true);
  });

  it('does not mistake an ordinary render or network error for a chunk failure', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({ message: 'Failed to fetch dynamically imported module' })).toBe(false);
  });
});

describe('loadWithRecovery', () => {
  it('returns the module untouched when the import works', async () => {
    const { env, reload, storage } = setup();
    const load = vi.fn(async () => ({ default: 'page' }));

    await expect(loadWithRecovery(load, 'DataIntake', env)).resolves.toEqual({ default: 'page' });

    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it('rethrows an ordinary error at once: no retry, no reload', async () => {
    const { env, reload } = setup();
    const load = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(loadWithRecovery(load, 'DataIntake', env)).rejects.toThrow('boom');

    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('retries a chunk failure once in place, and a transient one recovers without a reload', async () => {
    const { env, reload } = setup();
    const load = vi
      .fn<() => Promise<{ default: string }>>()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: 'page' });

    await expect(loadWithRecovery(load, 'DataIntake', env)).resolves.toEqual({ default: 'page' });

    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page ONCE when the chunk is still missing (stale tab after a deploy), holding the fallback meanwhile', async () => {
    const { env, reload, storage } = setup();
    const load = vi.fn(async () => {
      throw chunkError();
    });

    const pending = loadWithRecovery(load, 'DataIntake', env);

    expect(await settlement(pending)).toBe('pending');
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.map.has(MARK)).toBe(true);
  });

  it('does not reload a second time in the same session: the chunk error surfaces for the boundary', async () => {
    const { env, reload } = setup({ storage: memoryStorage({ [MARK]: '1' }) });
    const load = vi.fn(async () => {
      throw chunkError();
    });

    await expect(loadWithRecovery(load, 'DataIntake', env)).rejects.toThrow(/dynamically imported module/);

    expect(reload).not.toHaveBeenCalled();
  });

  it('never loops: repeated failures reload at most once per chunk', async () => {
    const { env, reload } = setup();
    const load = vi.fn(async () => {
      throw chunkError();
    });

    void loadWithRecovery(load, 'DataIntake', env); // the first failure earns the one reload
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await expect(loadWithRecovery(load, 'DataIntake', env)).rejects.toBeInstanceOf(TypeError);
    await expect(loadWithRecovery(load, 'DataIntake', env)).rejects.toBeInstanceOf(TypeError);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('guards each chunk separately', async () => {
    const { env, reload } = setup({ storage: memoryStorage({ [MARK]: '1' }) });
    const load = vi.fn(async () => {
      throw chunkError();
    });

    const other = loadWithRecovery(load, 'Settings', env);

    expect(await settlement(other)).toBe('pending');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads while offline (the browser would swap the app for its offline page) and does not retry either', async () => {
    const { env, reload, storage } = setup({ isOffline: () => true });
    const load = vi.fn(async () => {
      throw chunkError();
    });

    await expect(loadWithRecovery(load, 'DataIntake', env)).rejects.toThrow(/dynamically imported module/);

    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it('does not reload when the loop guard cannot be stored (blocked or absent session storage)', async () => {
    const load = vi.fn(async () => {
      throw chunkError();
    });

    const absent = setup({ storage: null });
    await expect(loadWithRecovery(load, 'DataIntake', absent.env)).rejects.toBeInstanceOf(TypeError);
    expect(absent.reload).not.toHaveBeenCalled();

    const throwing = setup({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
        removeItem: () => {},
      },
    });
    await expect(loadWithRecovery(load, 'DataIntake', throwing.env)).rejects.toBeInstanceOf(TypeError);
    expect(throwing.reload).not.toHaveBeenCalled();
  });

  it('forgets the mark once the chunk loads again, so a later deploy can auto-reload once more', async () => {
    const storage = memoryStorage({ [MARK]: '1' });
    const { env } = setup({ storage });

    await loadWithRecovery(async () => ({ default: 'page' }), 'DataIntake', env);

    expect(storage.map.has(MARK)).toBe(false);
  });
});
