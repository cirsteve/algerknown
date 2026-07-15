import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormatsImport from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import type { NodeType } from '../domain/node.js';

const addFormats = ajvFormatsImport as unknown as (ajv: Ajv2020) => void;

export type NodeSchemaMap = Partial<Record<NodeType, object>>;

export interface SchemaValidationResult {
  valid: boolean;
  errors?: string[];
}

export class SchemaRegistry {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true });
  private readonly validators = new Map<NodeType, ValidateFunction>();

  constructor(schemas: NodeSchemaMap) {
    addFormats(this.ajv);
    for (const [type, schema] of Object.entries(schemas) as Array<[NodeType, object]>) {
      this.validators.set(type, this.ajv.compile(schema));
    }
  }

  validate(type: NodeType, payload: unknown): SchemaValidationResult {
    const validator = this.validators.get(type);
    if (!validator) {
      return { valid: false, errors: [`no schema registered for node type "${type}"`] };
    }
    const valid = validator(payload);
    if (valid) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
    };
  }
}
