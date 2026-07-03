import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.warn(
    '[InsForge] Missing configuration. Set VITE_INSFORGE_BASE_URL and VITE_INSFORGE_ANON_KEY in your environment.'
  );
}

// Fail closed in production: never silently fall back to localhost when the
// backend is unconfigured. In dev we keep the localhost fallback so the app
// can boot against a local InsForge instance without extra env wiring.
const resolvedBaseUrl =
  baseUrl || (import.meta.env.DEV ? 'http://localhost:54321' : '');
const resolvedAnonKey = anonKey || '';

export const insforge = createClient({
  baseUrl: resolvedBaseUrl,
  anonKey: resolvedAnonKey,
});

export const isInsForgeConfigured = Boolean(baseUrl && anonKey);