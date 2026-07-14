import { describe, expect, it } from 'vitest';
import { GOVERNED_PACKAGE_NAME } from '../src/index.js';

describe('package scaffold', () => {
  it('exposes the package name', () => {
    expect(GOVERNED_PACKAGE_NAME).toBe('@algerknown/governed');
  });
});
