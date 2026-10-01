import { createElement, lazy, type ComponentType } from 'react';

// Every /app page is a lazily loaded chunk. A chunk fails to load when the
// browser is offline, and for any tab left open across a deploy: the new build
// no longer serves the old hashed file (the server answers with HTML), so the
// import() rejects. React.lazy caches that rejection, so the failure used to
// reach the app-wide error boundary, replace the sidebar and navigation with
// "contact support", and stay broken after the connection came back.

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's own CSS preload
  /Loading (?:CSS )?chunk [\w-]+ failed/i, // webpack-style
];

export function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** navigator.onLine is only trusted when it says offline; "online" can still mean no route out. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ChunkRecoveryEnv {
  /** null when session storage is unavailable, which disables the auto-reload. */
  storage?: StorageLike | null;
  isOffline?: () => boolean;
  reload?: () => void;
}

const RELOAD_MARK_PREFIX = 'eco-auditor:chunk-reload:';

function sessionStore(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked by the browser
  }
}

// True only for the first auto-reload of this chunk in this session. Without a
// working store the answer is always no: a reload we cannot remember is a
// reload loop waiting to happen.
function claimReload(storage: StorageLike | null, chunk: string): boolean {
  if (!storage) return false;
  try {
    const key = RELOAD_MARK_PREFIX + chunk;
    if (storage.getItem(key)) return false;
    storage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

// A chunk that loads again proves the reload worked, so a later deploy in the
// same session may auto-reload once more.
function releaseReload(storage: StorageLike | null, chunk: string): void {
  try {
    storage?.removeItem(RELOAD_MARK_PREFIX + chunk);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Runs a dynamic import and recovers from chunk-load failures:
 *  - a non-chunk error is rethrown untouched;
 *  - online, the import is retried once in place;
 *  - still failing, the page reloads ONCE per session per chunk (the old
 *    hashes are gone, a reload fetches the new index) and the returned promise
 *    never settles so the Suspense fallback holds until the page unloads;
 *  - offline, or after that one reload, the chunk error is thrown for the
 *    boundary to explain. Offline never reloads: the browser would swap the app
 *    for its own offline page.
 */
export async function loadWithRecovery<T>(
  load: () => Promise<T>,
  chunk: string,
  env: ChunkRecoveryEnv = {},
): Promise<T> {
  const offline = env.isOffline ?? isOffline;
  const storage = env.storage === undefined ? sessionStore() : env.storage;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const loaded = await load();
      releaseReload(storage, chunk);
      return loaded;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      lastError = error;
      if (offline()) break;
    }
  }

  if (!offline() && claimReload(storage, chunk)) {
    (env.reload ?? (() => window.location.reload()))();
    return new Promise<T>(() => {});
  }
  throw lastError;
}

// Bumped by retryChunkLoads(). A lazyRoute() that failed rebuilds its lazy()
// the next time it renders after a bump, which is how a retry gets a fresh
// import() instead of React's cached rejection.
let retryGeneration = 0;

/** Called when the user retries or navigates away from a failed page. */
export function retryChunkLoads(): void {
  retryGeneration += 1;
}

/**
 * React.lazy for a route, with loadWithRecovery around the import and the
 * ability to try again after a failure (see retryChunkLoads).
 */
export function lazyRoute(load: () => Promise<{ default: ComponentType }>, chunk: string): ComponentType {
  let failed = false;
  const build = () =>
    lazy(() =>
      loadWithRecovery(load, chunk).catch((error: unknown) => {
        failed = true;
        throw error;
      }),
    );
  let Page = build();
  let seenGeneration = retryGeneration;

  return function LazyRoute() {
    if (seenGeneration !== retryGeneration) {
      seenGeneration = retryGeneration;
      if (failed) {
        failed = false;
        Page = build();
      }
    }
    return createElement(Page);
  };
}
