import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx,js}', 'src/**/*.test.{ts,tsx,js}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server.cjs', 'server-security.cjs'],
    },
  },
});
