import { NODE_TYPES } from '../../domain/node.js';
import type { NodeType } from '../../domain/node.js';
import type { SchemaRegistry } from '../../config/schema-registry.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

export function evaluateNodeTypeKnown(nodeType: string): EvaluatorVerdict {
  if (!(NODE_TYPES as readonly string[]).includes(nodeType)) {
    return makeVerdict('schema-type', false, ['UNKNOWN_NODE_TYPE']);
  }
  return makeVerdict('schema-type', true);
}

export function evaluatePayloadSchema(registry: SchemaRegistry, nodeType: NodeType, payload: unknown): EvaluatorVerdict {
  const result = registry.validate(nodeType, payload);
  if (!result.valid) {
    const detail = result.errors ? { errors: result.errors } : undefined;
    return makeVerdict('schema-type', false, ['SCHEMA_VALIDATION_FAILED'], detail);
  }
  return makeVerdict('schema-type', true);
}
