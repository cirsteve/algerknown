/**
 * Config Module
 * Finds .algerknown root directory and initializes new knowledge bases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ALGERKNOWN_DIR = '.algerknown';
const INDEX_FILE = 'index.yaml';
const SCHEMAS_DIR = 'schemas';

/**
 * Walk up from the given directory to find .algerknown/
 * Similar to how git finds .git/
 * 
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Path to the knowledge base root (parent of .algerknown)
 * @throws Error if no .algerknown directory is found
 */
export function findRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const algerknownPath = path.join(current, ALGERKNOWN_DIR);
    if (fs.existsSync(algerknownPath) && fs.statSync(algerknownPath).isDirectory()) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error(
    `Not inside an Algerknown knowledge base. Run 'agn init' to create one.`
  );
}

/**
 * Get the path to the .algerknown directory
 */
export function getAlgerknownDir(root: string): string {
  return path.join(root, ALGERKNOWN_DIR);
}

/**
 * Get the path to the index.yaml file
 */
export function getIndexPath(root: string): string {
  return path.join(root, ALGERKNOWN_DIR, INDEX_FILE);
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
const DEFAULT_INDEX = `# yaml-language-server: $schema=./schemas/index.schema.json
version: "1.0.0"

entries: {}
`;

const INDEX_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/index.schema.json",
  "title": "Algerknown Index",
  "description": "Index file mapping entry IDs to file paths",
  "type": "object",
  "required": ["version", "entries"],
  "properties": {
    "version": {
      "type": "string",
      "description": "Schema version",
      "pattern": "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$"
    },
    "entries": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/indexEntry"
      }
    }
  },
  "$defs": {
    "indexEntry": {
      "type": "object",
      "required": ["path", "type"],
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path to the entry file"
        },
        "type": {
          "type": "string",
          "enum": ["summary", "entry"],
          "description": "Entry type"
        }
      }
    }
  }
}`;

/**
 * Initialize a new Algerknown knowledge base
 * 
 * @param targetDir - Directory to initialize (defaults to cwd)
 * @throws Error if already initialized
 */
export function init(targetDir: string = process.cwd()): void {
  const resolvedDir = path.resolve(targetDir);
  const algerknownPath = path.join(resolvedDir, ALGERKNOWN_DIR);

  // Check if already initialized
  if (fs.existsSync(algerknownPath)) {
    throw new Error(
      `Already initialized: ${algerknownPath} exists`
    );
  }

  // Create directory structure
  fs.mkdirSync(path.join(algerknownPath, SCHEMAS_DIR), { recursive: true });
  fs.mkdirSync(path.join(resolvedDir, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(resolvedDir, 'entries'), { recursive: true });

  // Write index.yaml
  fs.writeFileSync(
    path.join(algerknownPath, INDEX_FILE),
    DEFAULT_INDEX,
    'utf-8'
  );

  // Write index schema
  fs.writeFileSync(
    path.join(algerknownPath, SCHEMAS_DIR, 'index.schema.json'),
    INDEX_SCHEMA,
    'utf-8'
  );

  // Copy summary and entry schemas from bundled location
  // For now, we'll embed minimal versions inline
  const summarySchema = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'zkb-populated', 'schemas', 'summary.schema.json'),
    'utf-8'
  ).replace(/rankone\.dev\/zkb/g, 'algerknown.dev/schemas');

  const entrySchema = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'zkb-populated', 'schemas', 'entry.schema.json'),
    'utf-8'
  ).replace(/rankone\.dev\/zkb/g, 'algerknown.dev/schemas');

  fs.writeFileSync(
    path.join(algerknownPath, SCHEMAS_DIR, 'summary.schema.json'),
    summarySchema,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(algerknownPath, SCHEMAS_DIR, 'entry.schema.json'),
    entrySchema,
    'utf-8'
  );
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
