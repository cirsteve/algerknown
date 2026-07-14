import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * This setup file is registered globally (vitest.config.ts setupFiles), so
 * it also loads for the existing node-environment server test suite
 * (tests/governance, tests/auth). Everything below is guarded to jsdom-only
 * client tests so it never touches those supertest-driven HTTP tests.
 */
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { server } = await import('./mocks/server');

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
