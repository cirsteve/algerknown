import type { NodeSchemaMap } from './schema-registry.js';

export const DEFAULT_NODE_SCHEMAS: NodeSchemaMap = {
  fact: {
    type: 'object',
    required: ['statement'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      attributes: { type: 'object' },
    },
    additionalProperties: false,
  },
  resource: {
    type: 'object',
    required: ['locator'],
    properties: {
      locator: { type: 'string', minLength: 1 },
      label: { type: 'string' },
      kind: { type: 'string' },
    },
    additionalProperties: false,
  },
  prohibition: {
    type: 'object',
    required: ['rule'],
    properties: {
      rule: { type: 'string', minLength: 1 },
      scope: { type: 'string' },
    },
    additionalProperties: false,
  },
  observation: {
    type: 'object',
    required: ['description'],
    properties: {
      description: { type: 'string', minLength: 1 },
      observedAt: { type: 'string' },
      context: { type: 'object' },
    },
    additionalProperties: false,
  },
  interaction: {
    type: 'object',
    required: ['summary'],
    properties: {
      summary: { type: 'string', minLength: 1 },
      participants: { type: 'array', items: { type: 'string' } },
      occurredAt: { type: 'string' },
    },
    additionalProperties: false,
  },
  decision: {
    type: 'object',
    required: ['statement'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      rationale: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  proposal: {
    type: 'object',
    required: ['proposalId', 'summary'],
    properties: {
      proposalId: { type: 'string', minLength: 1 },
      summary: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};
