/**
 * Config Module
 * Finds .algerknown root directory and initializes new knowledge bases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AnyEntry } from './types.js';

const ALGERKNOWN_DIR = '.algerknown';
const INDEX_FILE = 'index.yaml';
const SCHEMAS_DIR = 'schemas';

/**
 * packages/core/schemas is the sole source of truth for schema files.
 * Resolved relative to this compiled module so it works from both
 * src/ (vitest) and dist/ (tsc build) layouts.
 */
const CORE_SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

/**
 * Maps an entry's type to the schema filename that validates it.
 * A Record keyed by AnyEntry['type'] forces this map to be updated
 * whenever a new entry type is added to the domain.
 */
export const SCHEMA_FILENAME_BY_TYPE: Record<AnyEntry['type'], string> = {
  summary: 'summary.schema.json',
  entry: 'entry.schema.json',
  primer: 'primer.schema.json',
};

/**
 * Get the knowledge base root directory.
 *
 * Resolution order:
 * 1. ALGERKNOWN_KB_ROOT environment variable (recommended for services)
 * 2. Walk up from startDir to find index.yaml (for CLI usage)
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Path to the knowledge base root (directory containing index.yaml)
 * @throws Error if no root can be determined
 */
export function findRoot(startDir?: string): string {
  // Prefer explicit env var for services
  const envRoot = process.env.ALGERKNOWN_KB_ROOT;
  if (envRoot) {
    const resolved = path.resolve(envRoot);
    const indexPath = path.join(resolved, INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      return resolved;
    }
    throw new Error(
      `ALGERKNOWN_KB_ROOT is set to '${envRoot}' but no index.yaml found there.`
    );
  }

  // Fall back to walking up directory tree (for CLI usage)
  let current = path.resolve(startDir ?? process.cwd());
  const root = path.parse(current).root;

  while (current !== root) {
    const indexPath = path.join(current, INDEX_FILE);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error(
    `Not inside an Algerknown knowledge base. Set ALGERKNOWN_KB_ROOT env var or run 'agn init' to create one.`
  );
}

/**
 * Get the path to the .algerknown directory
 */
export function getAlgerknownDir(root: string): string {
  return path.join(root, ALGERKNOWN_DIR);
}

/**
 * Get the path to the index.yaml file (at root, not in .algerknown)
 */
export function getIndexPath(root: string): string {
  return path.join(root, INDEX_FILE);
}

/**
 * Get the path to the schemas directory
 */
export function getSchemasDir(root: string): string {
  return path.join(root, ALGERKNOWN_DIR, SCHEMAS_DIR);
}

/**
 * Get the path to a specific schema file
 */
export function getSchemaPath(root: string, schemaName: string): string {
  return path.join(getSchemasDir(root), schemaName);
}

/**
 * Get the path to the summaries directory
 */
export function getSummariesDir(root: string): string {
  return path.join(root, 'summaries');
}

/**
 * Get the path to the entries directory
 */
export function getEntriesDir(root: string): string {
  return path.join(root, 'entries');
}

/**
 * Get the path to the primers directory
 */
export function getPrimersDir(root: string): string {
  return path.join(root, 'primers');
}

/**
 * Default index.yaml content for a newly initialized knowledge base
 */
const DEFAULT_INDEX = `# yaml-language-server: $schema=./.algerknown/schemas/index.schema.json
version: "1.0.0"

entries: {}
`;

/**
 * Initialize a new Algerknown knowledge base
 *
 * @param targetDir - Directory to initialize (defaults to cwd)
 * @throws Error if already fully initialized (has index.yaml)
 */
export function init(targetDir: string = process.cwd()): void {
  const resolvedDir = path.resolve(targetDir);
  const algerknownPath = path.join(resolvedDir, ALGERKNOWN_DIR);
  const indexPath = path.join(resolvedDir, INDEX_FILE);  // index.yaml at root
  const schemasPath = path.join(algerknownPath, SCHEMAS_DIR);

  const hasIndex = fs.existsSync(indexPath);

  // If index.yaml exists, it's already initialized
  // But we still allow re-running to update schemas
  if (hasIndex) {
    // Just update schemas, don't touch index or content directories
    updateSchemas(targetDir);
    return;
  }

  // Create directory structure
  fs.mkdirSync(schemasPath, { recursive: true });
  fs.mkdirSync(getSummariesDir(resolvedDir), { recursive: true });
  fs.mkdirSync(getEntriesDir(resolvedDir), { recursive: true });
  fs.mkdirSync(getPrimersDir(resolvedDir), { recursive: true });

  // Write index.yaml
  fs.writeFileSync(indexPath, DEFAULT_INDEX, 'utf-8');

  // Install all schemas
  writeSchemas(schemasPath);
}

/**
 * Update schemas in an existing knowledge base
 *
 * @param targetDir - Directory containing .algerknown (defaults to cwd)
 */
export function updateSchemas(targetDir: string = process.cwd()): void {
  const resolvedDir = path.resolve(targetDir);
  const schemasPath = path.join(resolvedDir, ALGERKNOWN_DIR, SCHEMAS_DIR);

  // Create schemas directory if it doesn't exist
  fs.mkdirSync(schemasPath, { recursive: true });

  // Primers directory may be missing on knowledge bases created before
  // primer support existed; restore it on every schema refresh.
  fs.mkdirSync(getPrimersDir(resolvedDir), { recursive: true });

  writeSchemas(schemasPath);
}

/**
 * Copy every schema file from packages/core/schemas (the sole source of
 * truth) into the target .algerknown/schemas directory.
 */
function writeSchemas(schemasPath: string): void {
  const schemaFiles = fs.readdirSync(CORE_SCHEMAS_DIR).filter(f => f.endsWith('.schema.json'));

  for (const file of schemaFiles) {
    fs.copyFileSync(path.join(CORE_SCHEMAS_DIR, file), path.join(schemasPath, file));
  }
}

/**
 * Check if currently inside an Algerknown knowledge base
 */
export function isInsideKnowledgeBase(startDir: string = process.cwd()): boolean {
  try {
    findRoot(startDir);
    return true;
  } catch {
    return false;
  }
}
