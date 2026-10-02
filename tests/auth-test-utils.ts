// Shared mounting helpers for the auth-page tests (email-verification-flow,
// auth-form-a11y). Not a test file itself. Each test file mocks
// ../src/lib/insforge before importing this module, so the pages below use
// that file's fake SDK. Same createRoot + act pattern as
// consent-storage.test.tsx (the repo has no testing-library). Plain .ts with
// createElement: a .tsx module exporting helpers next to a component trips
// react-refresh/only-export-components.
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Signup from '../src/pages/Signup';
import Login from '../src/pages/Login';
import ForgotPassword from '../src/pages/ForgotPassword';
import VerifyEmailCode from '../src/pages/VerifyEmailCode';
import { VERIFY_EMAIL_PATH } from '../src/components/auth/emailVerification';

type Entry = string | { pathname: string; search?: string; state?: unknown };
type Mounted = { container: HTMLDivElement; root: Root };

const mounted: Mounted[] = [];

function LocationProbe() {
  const location = useLocation();
  return h('output', { 'data-testid': 'location' }, location.pathname + location.search);
}

/** Mounts the auth routes at `entry`; `/app` is a stand-in for the signed-in app. */
export async function renderAuthRoutes(entry: Entry): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      h(
        MemoryRouter,
        { initialEntries: [entry] },
        h(
          Routes,
          null,
          h(Route, { path: '/signup', element: h(Signup) }),
          h(Route, { path: '/login', element: h(Login) }),
          h(Route, { path: '/forgot-password', element: h(ForgotPassword) }),
          h(Route, { path: VERIFY_EMAIL_PATH, element: h(VerifyEmailCode) }),
          h(Route, { path: '/app/*', element: h('p', null, 'Signed-in app') }),
        ),
        h(LocationProbe),
      ),
    );
  });
  await settle();
  return container;
}

export async function unmountAll(): Promise<void> {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
}

/** Lets pending promise chains (mocked SDK calls, navigation) finish. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function currentLocation(container: HTMLElement): string {
  return container.querySelector('[data-testid="location"]')?.textContent ?? '';
}

export function byId<T extends HTMLElement = HTMLInputElement>(container: HTMLElement, id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`#${id} not rendered`);
  return element;
}

export function buttonByText(container: HTMLElement, text: RegExp): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => text.test(b.textContent ?? ''));
  if (!button) throw new Error(`no button matching ${String(text)}`);
  return button;
}

export function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!button) throw new Error('no submit button');
  return button;
}

/** Sets a controlled input's value the way a user edit does (React listens for `input`). */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function blurField(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}
