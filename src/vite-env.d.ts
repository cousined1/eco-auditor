/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** InsForge backend base URL (e.g. https://your-app.region.insforge.app) */
  readonly VITE_INSFORGE_BASE_URL: string;
  /** InsForge anonymous/public API key */
  readonly VITE_INSFORGE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}