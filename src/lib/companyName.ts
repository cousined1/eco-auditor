// The signed-in company's name, for the app shell's header. The header used to read
// it from the auth profile, which never holds one, so it always said "Your
// organization" (F-C-03). The screens that load or change the company publish its
// name here; the header subscribes.
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

export function publishCompanyName(name: string | null): void {
  if (name === current) return;
  current = name;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The last company name published in this session, or null before any screen has loaded it. */
export function useCompanyName(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
