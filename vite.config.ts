import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin, Connect } from 'vite';

/**
 * spaFallback — routes all non-asset requests to index.html during
 * `vite preview` so react-router-dom can handle client-side navigation.
 *
 * Vite's built-in preview server does not perform SPA history fallback
 * out of the box. This lightweight plugin patches it in without any
 * extra runtime dependencies, keeping the Railway Nixpacks build clean.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configurePreviewServer(server) {
      server.middlewares.use((req: Connect.IncomingMessage, _res, next) => {
        const url = req.url ?? '/';
        // Pass through: API calls, static assets (contain a dot in the last segment)
        const lastSegment = url.split('/').pop() ?? '';
        if (lastSegment.includes('.') || url.startsWith('/@')) {
          return next();
        }
        req.url = '/index.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spaFallback()],

  build: {
    outDir: 'static',
    // Emit a sourcemap for production error tracking (remove if bundle size is a concern)
    sourcemap: false,
    // Raise the warning threshold slightly; recharts bundles are large by design
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Code-split vendor bundles for better long-term caching
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts')) return 'charts';
          if (id.includes('react-router-dom')) return 'router';
          if (id.includes('react') || id.includes('react-dom')) return 'vendor';
        },
      },
    },
  },

  preview: {
    // Railway injects PORT; fall back to Vite's default 4173 locally
    port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 4173,
    host: true,       // Bind to 0.0.0.0 so Railway's proxy can reach it
    strictPort: true, // Fail fast if the port is already taken
  },
});
