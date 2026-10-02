import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keyboard containment for a modal dialog: moves focus in on open, keeps Tab
 * inside it, closes on Escape, and returns focus to whatever opened it.
 *
 * `role="dialog" aria-modal="true"` only tells assistive tech the content
 * behind is inert — it does not make it so. Without this, Tab walks straight
 * out of the dialog into the page underneath, which is WCAG 2.4.3 and 2.1.2.
 *
 * Returns a ref to attach to the dialog element.
 */
export function useFocusTrap<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);

  // Callers pass an inline arrow, i.e. a new `onClose` on every render. Keying the
  // effect below on it re-ran the focus-in step after every render of the parent,
  // so each keystroke in the chat input moved focus to "Close chat". The effect
  // runs once per mount; Escape reads the latest callback from this ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    // Prefer the first control; fall back to the dialog itself so focus is
    // never left behind on the trigger.
    (focusable()[0] ?? node).focus();

    // Arrow const rather than a hoisted `function`, so TypeScript keeps the
    // non-null narrowing of `node` from the guard above inside the closure.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back if it somehow escaped.
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}
