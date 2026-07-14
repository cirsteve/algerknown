import { describe, expect, it } from 'vitest';
import { ALGERKNOWN_ADAPTER_NODE_SCHEMAS } from '../../../src/adapters/algerknown/schemas.js';

describe('ALGERKNOWN_ADAPTER_NODE_SCHEMAS', () => {
  it('registers exactly the node types the adapter mapping can round-trip', () => {
    expect(Object.keys(ALGERKNOWN_ADAPTER_NODE_SCHEMAS).sort()).toEqual(['fact', 'observation', 'prohibition', 'resource']);
  });

  it('does not register interaction/decision/proposal, which mapping.ts has no dossier representation for', () => {
    expect(ALGERKNOWN_ADAPTER_NODE_SCHEMAS.interaction).toBeUndefined();
    expect(ALGERKNOWN_ADAPTER_NODE_SCHEMAS.decision).toBeUndefined();
    expect(ALGERKNOWN_ADAPTER_NODE_SCHEMAS.proposal).toBeUndefined();
  });
});
