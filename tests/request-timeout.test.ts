// F-B-15: a hung dashboard request spun forever. withDeadline bounds a request
// (and whatever is read from it) and lets the caller tell a timeout from an abort.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError, withDeadline } from '../src/lib/requestTimeout';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const neverSettles = () => new Promise<never>(() => {});

describe('withDeadline', () => {
  it('defaults to a 15 second deadline, matching the RT-06 timeouts elsewhere', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);

    const pending = withDeadline(neverSettles);
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('resolves with the value and leaves no timer behind', async () => {
    const result = await withDeadline(async () => 'summary');

    expect(result).toBe('summary');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates the run\'s own error and leaves no timer behind', async () => {
    await expect(withDeadline(async () => Promise.reject(new Error('HTTP 500')))).rejects.toThrow('HTTP 500');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a synchronous throw into a rejection and clears the timer', async () => {
    await expect(
      withDeadline(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the signal it hands to the run when the deadline passes', async () => {
    let seen: AbortSignal | undefined;
    const pending = withDeadline(
      (signal) => {
        seen = signal;
        return neverSettles();
      },
      { timeoutMs: 1_000 },
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(seen?.aborted).toBe(true);
  });

  it('still gives up at the deadline when the run ignores the signal (the database client cannot be aborted)', async () => {
    const pending = withDeadline(() => neverSettles(), { timeoutMs: 500 });
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('is not fooled by a run that settles after the deadline', async () => {
    let finish: (value: string) => void = () => {};
    const pending = withDeadline(() => new Promise<string>((resolve) => { finish = resolve; }), { timeoutMs: 100 });
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    finish('too late');
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('aborts the run when the caller aborts (unmount, retry) and reports that as an abort, not a timeout', async () => {
    const outer = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withDeadline(
      (signal) => {
        seen = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      },
      { signal: outer.signal },
    );
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    outer.abort();
    await assertion;
    expect(seen?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts already aborted when the caller\'s signal is', async () => {
    const outer = new AbortController();
    outer.abort();
    let seen: AbortSignal | undefined;
    const pending = withDeadline(
      (signal) => {
        seen = signal;
        return Promise.resolve('ok');
      },
      { signal: outer.signal },
    );

    await expect(pending).resolves.toBe('ok');
    expect(seen?.aborted).toBe(true);
  });
});
