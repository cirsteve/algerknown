import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  envDir: '../..',
  build: {
    outDir: 'dist/client',
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
