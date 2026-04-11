import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  console.warn(
    '[InsForge] Missing configuration. Set VITE_INSFORGE_BASE_URL and VITE_INSFORGE_ANON_KEY in your environment.'
  );
}

export const insforge = createClient({
  baseUrl: baseUrl || 'http://localhost:54321',
  anonKey: anonKey || '',
});

export const isInsForgeConfigured = Boolean(baseUrl && anonKey);