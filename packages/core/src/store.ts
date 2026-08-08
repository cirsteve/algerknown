/**
 * Store Module
 * Read/write YAML files for entries and summaries
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { AnyEntry, Primer, Index } from './types.js';
import { findRoot, getIndexPath, getSummariesDir, getEntriesDir, getPrimersDir, SCHEMA_FILENAME_BY_TYPE } from './config.js';
import { assertAllowedSourcePath } from './source-guard.js';

/**
 * Maps an entry's type to the directory its files live in. A Record keyed
 * by AnyEntry['type'] forces this map to be updated whenever a new entry
 * type is added to the domain, instead of silently falling through.
 */
const ENTRY_DIR_BY_TYPE: Record<AnyEntry['type'], (root: string) => string> = {
  summary: getSummariesDir,
  entry: getEntriesDir,
  primer: getPrimersDir,
};

/**
 * Read and parse a YAML file
 */
function readYamlFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as T;
}

/**
 * Write data to a YAML file
 */
function writeYamlFile<T>(filePath: string, data: T): void {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read the index.yaml file
 */
export function getIndex(root?: string): Index {
  const kbRoot = root ?? findRoot();
  const indexPath = getIndexPath(kbRoot);
  
  if (!fs.existsSync(indexPath)) {
    return { version: '1.0.0', entries: {} };
  }
  
  return readYamlFile<Index>(indexPath);
}

/**
 * Write the index.yaml file
 */
export function saveIndex(index: Index, root?: string): void {
  const kbRoot = root ?? findRoot();
  const indexPath = getIndexPath(kbRoot);
  
  // Add yaml-language-server comment at top
  const content = `# yaml-language-server: $schema=./schemas/index.schema.json\n${yaml.dump(index, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })}`;
  
  fs.writeFileSync(indexPath, content, 'utf-8');
}

/**
 * Resolve the file path for an entry ID
 */
export function resolveEntryPath(id: string, root?: string): string | null {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  const indexEntry = index.entries[id];
  if (!indexEntry) {
    return null;
  }
  
  // Resolve relative path from root directory
  return path.resolve(kbRoot, indexEntry.path);
}

/**
 * Read an entry by ID
 * 
 * @param id - Entry ID
 * @param root - Knowledge base root (optional, auto-detected)
 * @returns Entry/Summary or null if not found
 */
export function readEntry(id: string, root?: string): AnyEntry | null {
  const kbRoot = root ?? findRoot();
  const entryPath = resolveEntryPath(id, kbRoot);
  
  if (!entryPath || !fs.existsSync(entryPath)) {
    return null;
  }
  
  return readYamlFile<AnyEntry>(entryPath);
}

/**
 * Determine the file path for a new entry
 */
function getEntryFilePath(entry: AnyEntry, root: string): string {
  return path.join(ENTRY_DIR_BY_TYPE[entry.type](root), `${entry.id}.yaml`);
}

/**
 * Get the relative path from root to the entry file
 */
function getRelativePath(entryPath: string, root: string): string {
  return path.relative(root, entryPath);
}

/**
 * Write an entry (creates or updates)
 * 
 * @param entry - Entry to write
 * @param root - Knowledge base root (optional)
 */
export function writeEntry(entry: AnyEntry, root?: string): void {
  const kbRoot = root ?? findRoot();

  // Every primer write must go through source-path authorization before
  // anything is persisted, whether creating or updating. The persisted
  // record stores the guard's canonical path, so an in-root symlink alias
  // the caller passed in never ends up on disk in place of its target.
  const entryToPersist: AnyEntry = entry.type === 'primer'
    ? { ...entry, source: { ...entry.source, path: assertAllowedSourcePath(entry.source.path) } }
    : entry;

  // Determine file path
  const existingPath = resolveEntryPath(entryToPersist.id, kbRoot);
  const entryPath = existingPath ?? getEntryFilePath(entryToPersist, kbRoot);

  // Add yaml-language-server comment
  const schemaRef = `../.algerknown/schemas/${SCHEMA_FILENAME_BY_TYPE[entryToPersist.type]}`;

  const content = `# yaml-language-server: $schema=${schemaRef}\n${yaml.dump(entryToPersist, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  })}`;

  // Ensure directory exists
  const dir = path.dirname(entryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(entryPath, content, 'utf-8');

  // Update index
  const index = getIndex(kbRoot);
  index.entries[entryToPersist.id] = {
    path: getRelativePath(entryPath, kbRoot),
    type: entryToPersist.type,
  };
  saveIndex(index, kbRoot);
}

/**
 * Delete an entry by ID
 * 
 * @param id - Entry ID to delete
 * @param root - Knowledge base root (optional)
 * @returns true if deleted, false if not found
 */
export function deleteEntry(id: string, root?: string): boolean {
  const kbRoot = root ?? findRoot();
  const entryPath = resolveEntryPath(id, kbRoot);
  
  if (!entryPath || !fs.existsSync(entryPath)) {
    return false;
  }
  
  // Remove file
  fs.unlinkSync(entryPath);
  
  // Update index
  const index = getIndex(kbRoot);
  delete index.entries[id];
  saveIndex(index, kbRoot);
  
  return true;
}

/**
 * List all entries in the index
 * 
 * @param root - Knowledge base root (optional)
 * @returns Array of {id, path, type}
 */
export function listEntries(root?: string): Array<{ id: string; path: string; type: AnyEntry['type'] }> {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  return Object.entries(index.entries).map(([id, entry]) => ({
    id,
    path: entry.path,
    type: entry.type,
  }));
}

/**
 * Read all entries (load full content)
 * 
 * @param root - Knowledge base root (optional)
 * @returns Array of all entries
 */
export function readAllEntries(root?: string): AnyEntry[] {
  const kbRoot = root ?? findRoot();
  const entries = listEntries(kbRoot);
  
  return entries
    .map(e => readEntry(e.id, kbRoot))
    .filter((e): e is AnyEntry => e !== null);
}

/**
 * Check if an entry exists
 */
export function entryExists(id: string, root?: string): boolean {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  return id in index.entries;
}

/**
 * Read the raw content a primer's source.path points to.
 *
 * Runs the same source-path authorization guard as writeEntry before
 * touching the filesystem. Never writes or copies the source - it only
 * returns guarded content.
 *
 * @param primer - Primer whose source should be read
 * @returns the raw file content at primer.source.path
 */
export function readPrimerSource(primer: Primer): string {
  const canonicalPath = assertAllowedSourcePath(primer.source.path);
  return fs.readFileSync(canonicalPath, 'utf-8');
}
