/**
 * Validator Module
 * JSON Schema validation using AJV with cross-schema reference support
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AnyEntry, ValidationResult, ValidationError } from './types.js';
import { findRoot, getSchemasDir } from './config.js';

// Singleton AJV instance (lazy-loaded per root)
let ajvInstance: Ajv2020 | null = null;
let loadedRoot: string | null = null;

/**
 * Load all schemas from the .algerknown/schemas directory
 */
function loadSchemas(root: string): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  const schemasDir = getSchemasDir(root);
  
  if (!fs.existsSync(schemasDir)) {
    throw new Error(`Schemas directory not found: ${schemasDir}`);
  }

  // Load all schema files
  const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));
  
  for (const file of schemaFiles) {
    const schemaPath = path.join(schemasDir, file);
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);
    
    // Add schema with its filename as the key for $ref resolution
    ajv.addSchema(schema, file);
  }

  return ajv;
}

/**
 * Get or create AJV instance for the given root
 */
function getAjv(root: string): Ajv2020 {
  if (ajvInstance && loadedRoot === root) {
    return ajvInstance;
  }
  
  ajvInstance = loadSchemas(root);
  loadedRoot = root;
  return ajvInstance;
}

/**
 * Reset the cached AJV instance (useful for testing)
 */
export function resetValidator(): void {
  ajvInstance = null;
  loadedRoot = null;
}

/**
 * Validate an entry against its schema
 * 
 * @param entry - Entry to validate
 * @param root - Knowledge base root (optional)
 * @returns Validation result with errors if any
 */
export function validate(entry: AnyEntry, root?: string): ValidationResult {
  const kbRoot = root ?? findRoot();
  const ajv = getAjv(kbRoot);
  
  // Determine which schema to use
  const schemaFile = entry.type === 'summary' 
    ? 'summary.schema.json' 
    : 'entry.schema.json';
  
  const validateFn = ajv.getSchema(schemaFile);
  
  if (!validateFn) {
    return {
      valid: false,
      errors: [{
        path: '',
        message: `Schema not found: ${schemaFile}`,
      }],
    };
  }
  
  const valid = validateFn(entry);
  
  if (valid) {
    return { valid: true, errors: [] };
  }
  
  // Convert AJV errors to our format
  const errors: ValidationError[] = (validateFn.errors ?? []).map(err => ({
    path: err.instancePath || '/',
    message: err.message ?? 'Unknown validation error',
    keyword: err.keyword,
  }));
  
  return { valid: false, errors };
}

/**
 * Validate all entries in the knowledge base
 * 
 * @param root - Knowledge base root (optional)
 * @returns Map of entry ID to validation result
 */
export function validateAll(root?: string): Map<string, ValidationResult> {
  const kbRoot = root ?? findRoot();
  
  // Import here to avoid circular dependency
  const { readAllEntries } = require('./store.js');
  const entries = readAllEntries(kbRoot) as AnyEntry[];
  
  const results = new Map<string, ValidationResult>();
  
  for (const entry of entries) {
    results.set(entry.id, validate(entry, kbRoot));
  }
  
  return results;
}

/**
 * Check if an entry is valid (convenience function)
 */
export function isValid(entry: AnyEntry, root?: string): boolean {
  return validate(entry, root).valid;
}

/**
 * Format validation errors for display
 */
export function formatErrors(result: ValidationResult): string[] {
  return result.errors.map(err => {
    const location = err.path || 'root';
    return `${location}: ${err.message}`;
  });
}
