// A stale PID must never be killed. Found while several suites ran at once: a
// taskkill /F /T /PID of an exited child's recycled PID ended other suites' workers
// and servers ("Worker exited unexpectedly", containers left behind). The helpers may
// only kill a child Node still holds. The exited children here are fakes whose PID is
// 424242: Windows PIDs are multiples of four, so that PID cannot exist and a
// regression could never hit a real process; the live-child case uses a real child
// this test spawned itself.
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import * as helpers from './e2e-helpers';

function fakeChild(exitCode: number | null, signalCode: NodeJS.Signals | null = null) {
  const kill = vi.fn(() => true);
  return { child: { pid: 424242, exitCode, signalCode, kill } as unknown as ChildProcess, kill };
}

describe('e2e helpers never kill a stale PID', () => {
  it.each([
    ['exited with a code', 0, null],
    ['was killed by a signal', null, 'SIGKILL'],
  ] as const)('forceKillSync leaves a child that %s alone', (_label, exitCode, signalCode) => {
    const { child, kill } = fakeChild(exitCode, signalCode as NodeJS.Signals | null);
    helpers.forceKillSync(child);
    expect(kill).not.toHaveBeenCalled();
  });

  it('killTree leaves an exited child alone', () => {
    const { child, kill } = fakeChild(1);
    helpers.killTree(child);
    expect(kill).not.toHaveBeenCalled();
  });

  it('still kills a live child it owns', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    helpers.forceKillSync(child);
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the live child survived forceKillSync')), 10_000)),
    ]);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('has no kill-by-bare-PID helper', () => {
    expect('killPid' in helpers).toBe(false);
  });
});
