/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  envDir: '../..',
  build: {
    outDir: 'dist/client',
  },
  // The client is the only part of this package with a DOM to test, so the
  // suite runs in jsdom and stays scoped to src/client.
  test: {
    environment: 'jsdom',
    include: ['src/client/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:2393',
        changeOrigin: true,
      },
      '/rag': {
        target: 'http://localhost:4735',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rag/, ''),
      },
    },
  },
});
