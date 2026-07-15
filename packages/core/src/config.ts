/**
 * Config Module
 * Finds .algerknown root directory and initializes new knowledge bases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ALGERKNOWN_DIR = '.algerknown';
const INDEX_FILE = 'index.yaml';
const SCHEMAS_DIR = 'schemas';

// The package's own authoring-source schemas (packages/core/schemas/*.json).
// Resolved relative to this module's location (this package builds to
// CommonJS, so __dirname is the compiled-output directory) so it works
// identically from source (src/config.ts), compiled dist (dist/config.js),
// and a packaged install (node_modules/@algerknown/core/dist/config.js) — in
// every case, schemas/ sits one directory up from this file's directory.
const PACKAGE_SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

const SCHEMA_FILENAMES = ['index.schema.json', 'summary.schema.json', 'entry.schema.json'] as const;

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
 * Default schemas to include in a new knowledge base
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
  fs.mkdirSync(path.join(resolvedDir, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(resolvedDir, 'entries'), { recursive: true });

  // Write index.yaml (only if it doesn't exist)
  if (!hasIndex) {
    fs.writeFileSync(indexPath, DEFAULT_INDEX, 'utf-8');
  }

  // Write all schemas
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

  writeSchemas(schemasPath);
}

/**
 * Copy a single file's bytes to `dest`, replacing it atomically (write to a
 * sibling temp file, then rename over the destination).
 */
function copyFileAtomic(src: string, dest: string): void {
  const tmpDest = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  fs.copyFileSync(src, tmpDest);
  fs.renameSync(tmpDest, dest);
}

/**
 * Write all package schema files to a directory, byte-for-byte identical to
 * packages/core/schemas/*.json — the package's only hand-edited schema source.
 */
function writeSchemas(schemasPath: string): void {
  for (const filename of SCHEMA_FILENAMES) {
    copyFileAtomic(path.join(PACKAGE_SCHEMAS_DIR, filename), path.join(schemasPath, filename));
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
