// Bounded waits for the authenticated pages. RT-06 gave the calls in api.ts,
// stripe.ts and session.ts a 15 s timeout, but the dashboard's fetches and the
// calculator's first load had none: on a stalled connection "Loading..." stayed
// on screen indefinitely with no error and no way to retry.

export const REQUEST_TIMEOUT_MS = 15_000;

export class RequestTimeoutError extends Error {
  constructor(message = 'The request took too long to respond.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export interface DeadlineOptions {
  timeoutMs?: number;
  /** Aborting this aborts the run too (unmount, superseded by a retry). */
  signal?: AbortSignal;
}

/**
 * Runs `run` with an AbortSignal that fires at the deadline or when
 * `options.signal` aborts. The returned promise rejects with RequestTimeoutError
 * at the deadline even when `run` cannot be cancelled (the InsForge database
 * client takes no signal), so the caller can always leave its loading state.
 *
 * The clock covers the whole run, response bodies included: a server that sends
 * headers and then stalls is cut off too.
 */
export function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  { timeoutMs = REQUEST_TIMEOUT_MS, signal: outer }: DeadlineOptions = {},
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const abortFromOuter = () => controller.abort(outer?.reason);
    const timer = setTimeout(() => {
      reject(new RequestTimeoutError());
      controller.abort();
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', abortFromOuter);
    };

    if (outer?.aborted) abortFromOuter();
    else outer?.addEventListener('abort', abortFromOuter, { once: true });

    try {
      run(controller.signal).then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
