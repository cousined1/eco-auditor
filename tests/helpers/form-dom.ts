// Small helpers for tests that drive a mounted React tree by hand (the repo has
// no testing-library). Not a test file itself.
import { act } from 'react';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Sets a controlled field's value the way a user edit does: React listens for `input` (`change` on a select). */
export async function setField(field: Field, value: string): Promise<void> {
  const proto =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

/** Lets pending promise chains (mocked requests, state updates that follow them) finish. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Clicks an element inside act(), then lets the promises it started finish. */
export async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}

/** The first button whose text matches. */
export function buttonNamed(container: HTMLElement, name: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) => name.test(button.textContent ?? ''));
  if (!found) throw new Error(`no button matching ${String(name)}`);
  return found;
}
