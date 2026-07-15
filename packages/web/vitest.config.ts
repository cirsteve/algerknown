import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['tests/client/**', 'jsdom']],
    setupFiles: ['./tests/client/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
