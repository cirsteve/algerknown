import { DEFAULT_NODE_SCHEMAS } from '../../config/default-schemas.js';
import type { NodeSchemaMap } from '../../config/schema-registry.js';

/**
 * The default fact/observation schemas already carry an open `attributes`/
 * `context` bag, which is enough room for this adapter's fact and evidence /
 * known-gap extensions. resource and prohibition have no such bag by
 * default, so this adapter registers its own schemas for those two types
 * only, adding an `extensions` object to hold algerknown-specific fields
 * (label/purpose, matcher variants/forbidden_phrasings) losslessly without
 * changing the governed core schema for every other caller.
 */
export const ALGERKNOWN_ADAPTER_NODE_SCHEMAS: NodeSchemaMap = {
  ...DEFAULT_NODE_SCHEMAS,
  resource: {
    type: 'object',
    required: ['locator'],
    properties: {
      locator: { type: 'string', minLength: 1 },
      label: { type: 'string' },
      kind: { type: 'string' },
      extensions: { type: 'object' },
    },
    additionalProperties: false,
  },
  prohibition: {
    type: 'object',
    required: ['rule'],
    properties: {
      rule: { type: 'string', minLength: 1 },
      scope: { type: 'string' },
      extensions: { type: 'object' },
    },
    additionalProperties: false,
  },
};
