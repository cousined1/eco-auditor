// F-C-02 regression: useFocusTrap re-ran its focus-in step on every render.
//
// Callers pass an inline `onClose` arrow, and the effect was keyed on it, so each
// re-render of the parent (every keystroke in the chat input) tore the trap down
// and set it up again: the cleanup restored focus to the opener, the set-up moved
// focus to the FIRST control in the dialog ("Close chat"). The visitor got one
// character into the input, the rest went to the Close button, and a Space
// activated it and closed the panel.
//
// These tests drive the hook the way the chat does (a parent that re-renders on
// every keystroke and hands over a fresh onClose each time) and assert behaviour:
// which element has focus, what is open, what onClose received.
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '../src/hooks/useFocusTrap';

function Dialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useFocusTrap<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test dialog">
      {children}
    </div>
  );
}

// Same shape as ChatbotWidget: state lives in the parent, so every keystroke
// re-renders it, and onClose is a new closure each time.
function Harness({ onClosed }: { onClosed: (textAtClose: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog
          onClose={() => {
            setOpen(false);
            onClosed(text);
          }}
        >
          <button type="button" aria-label="Close">
            x
          </button>
          <input aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} />
          <button type="button" aria-label="Send">
            &gt;
          </button>
        </Dialog>
      )}
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openDialog(onClosed: (textAtClose: string) => void = () => {}) {
  await act(async () => root.render(<Harness onClosed={onClosed} />));
  const opener = container.querySelector<HTMLButtonElement>('[data-testid="opener"]')!;
  await act(async () => {
    opener.focus();
    opener.click();
  });
  return opener;
}

const dialog = () => container.querySelector('[role="dialog"]');
const control = (name: string) => container.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;

// A keystroke as React sees it: set the value through the native setter, then
// dispatch a bubbling input event (React listens for `input`, not `change`).
async function typeChar(input: HTMLInputElement, char: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, input.value + char);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', async () => {
    await openDialog();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  it('keeps focus in the input while the parent re-renders on every keystroke', async () => {
    await openDialog();
    const input = control('Message') as HTMLInputElement;
    await act(async () => input.focus());

    for (const [index, char] of ['h', 'i', ' ', 't', 'h', 'e', 'r', 'e'].entries()) {
      await typeChar(input, char);
      expect(document.activeElement, `focus after keystroke ${index + 1}`).toBe(input);
    }
    expect(input.value).toBe('hi there');
  });

  it('does not close the dialog when a Space is typed into the input', async () => {
    const onClosed = vi.fn();
    await openDialog(onClosed);
    const input = control('Message') as HTMLInputElement;
    await act(async () => input.focus());

    await typeChar(input, 'h');
    await typeChar(input, 'i');
    await typeChar(input, ' ');
    await press(' ');

    expect(dialog()).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(input.value).toBe('hi ');
    expect(document.activeElement).toBe(input);
  });

  it('closes on Escape, calls the LATEST onClose, and returns focus to the opener', async () => {
    const onClosed = vi.fn();
    const opener = await openDialog(onClosed);
    const input = control('Message') as HTMLInputElement;
    await act(async () => input.focus());
    await typeChar(input, 'o');
    await typeChar(input, 'k');

    await press('Escape');

    expect(dialog()).toBeNull();
    // Called once, and with the text from the newest render (not the render the
    // trap was set up in), so a stale closure would report ''.
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith('ok');
    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab from the last control to the first and Shift+Tab back', async () => {
    await openDialog();
    const first = control('Close');
    const last = control('Send');

    await act(async () => last.focus());
    const forward = await press('Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = await press('Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone between the first and last controls', async () => {
    await openDialog();
    await act(async () => control('Message').focus());
    const event = await press('Tab');
    expect(event.defaultPrevented).toBe(false);
  });
});
