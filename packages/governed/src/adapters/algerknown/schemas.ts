import { DEFAULT_NODE_SCHEMAS } from '../../config/default-schemas.js';
import type { NodeSchemaMap } from '../../config/schema-registry.js';

/**
 * Only the four node types this adapter's mapping can actually round-trip
 * (fact, resource, prohibition, observation) are registered here --
 * deliberately NOT a spread of DEFAULT_NODE_SCHEMAS, which also carries
 * interaction/decision/proposal. Registering those would let a WriteCommand
 * pass schema validation at the orchestrator only to have
 * Repository.commit() throw later, since mapping.ts has no dossier
 * representation for them; omitting them here makes an unsupported node
 * type fail fast at schema-eval time instead.
 *
 * The default fact/observation schemas already carry an open `attributes`/
 * `context` bag, which is enough room for this adapter's fact and evidence /
 * known-gap extensions. resource and prohibition have no such bag by
 * default, so this adapter registers its own schemas for those two types,
 * adding an `extensions` object to hold algerknown-specific fields
 * (label/purpose, matcher variants/forbidden_phrasings) losslessly without
 * changing the governed core schema for every other caller.
 */
export const ALGERKNOWN_ADAPTER_NODE_SCHEMAS: NodeSchemaMap = {
  fact: DEFAULT_NODE_SCHEMAS.fact!,
  observation: DEFAULT_NODE_SCHEMAS.observation!,
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
