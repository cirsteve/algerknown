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
  const { configure } = await import('@testing-library/react');

  // Generous async timeout: each render here does a real (MSW-mocked) round
  // trip for the auth session before the governance fetch, so the default
  // 1000ms findBy*/waitFor budget is tight under load.
  configure({ asyncUtilTimeout: 4000 });

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
