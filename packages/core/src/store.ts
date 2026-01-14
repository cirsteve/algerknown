/**
 * Store Module
 * Read/write YAML files for entries and summaries
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { AnyEntry, Summary, Entry, Index } from './types.js';
import { findRoot, getIndexPath, getSummariesDir, getEntriesDir, getAlgerknownDir } from './config.js';

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
  
  // Resolve relative path from .algerknown directory
  return path.resolve(path.join(getAlgerknownDir(kbRoot), indexEntry.path));
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
  if (entry.type === 'summary') {
    return path.join(getSummariesDir(root), `${entry.id}.yaml`);
  } else {
    return path.join(getEntriesDir(root), `${entry.id}.yaml`);
  }
}

/**
 * Get the relative path from .algerknown to the entry file
 */
function getRelativePath(entryPath: string, root: string): string {
  const algerknownDir = getAlgerknownDir(root);
  return path.relative(algerknownDir, entryPath);
}

/**
 * Write an entry (creates or updates)
 * 
 * @param entry - Entry to write
 * @param root - Knowledge base root (optional)
 */
export function writeEntry(entry: AnyEntry, root?: string): void {
  const kbRoot = root ?? findRoot();
  
  // Determine file path
  const existingPath = resolveEntryPath(entry.id, kbRoot);
  const entryPath = existingPath ?? getEntryFilePath(entry, kbRoot);
  
  // Add yaml-language-server comment
  const schemaRef = entry.type === 'summary' 
    ? '../.algerknown/schemas/summary.schema.json'
    : '../.algerknown/schemas/entry.schema.json';
  
  const content = `# yaml-language-server: $schema=${schemaRef}\n${yaml.dump(entry, {
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
  index.entries[entry.id] = {
    path: getRelativePath(entryPath, kbRoot),
    type: entry.type,
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
export function listEntries(root?: string): Array<{ id: string; path: string; type: 'summary' | 'entry' }> {
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
