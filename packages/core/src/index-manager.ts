/**
 * Index Manager Module
 * CRUD operations on index.yaml - re-exports from store for convenience
 * This module is kept for API consistency with the implementation plan
 */

import { getIndex, saveIndex, listEntries, entryExists } from './store.js';
import type { Index, IndexEntry } from './types.js';
import { findRoot } from './config.js';

// Re-export core index functions
export { getIndex, saveIndex, listEntries, entryExists };

/**
 * Add an entry to the index
 * 
 * @param id - Entry ID
 * @param relativePath - Path relative to .algerknown directory
 * @param type - Entry type ('summary' or 'entry')
 * @param root - Knowledge base root (optional)
 */
export function addToIndex(
  id: string, 
  relativePath: string, 
  type: 'summary' | 'entry',
  root?: string
): void {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  index.entries[id] = { path: relativePath, type };
  saveIndex(index, kbRoot);
}

/**
 * Remove an entry from the index (does not delete the file)
 * 
 * @param id - Entry ID to remove
 * @param root - Knowledge base root (optional)
 * @returns true if removed, false if not found
 */
export function removeFromIndex(id: string, root?: string): boolean {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  if (!(id in index.entries)) {
    return false;
  }
  
  delete index.entries[id];
  saveIndex(index, kbRoot);
  return true;
}

/**
 * Get a specific index entry
 * 
 * @param id - Entry ID
 * @param root - Knowledge base root (optional)
 * @returns IndexEntry or null if not found
 */
export function getIndexEntry(id: string, root?: string): IndexEntry | null {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  return index.entries[id] ?? null;
}

/**
 * Update the path of an existing index entry
 * 
 * @param id - Entry ID
 * @param newPath - New relative path
 * @param root - Knowledge base root (optional)
 * @returns true if updated, false if not found
 */
export function updateIndexPath(id: string, newPath: string, root?: string): boolean {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  if (!(id in index.entries)) {
    return false;
  }
  
  index.entries[id].path = newPath;
  saveIndex(index, kbRoot);
  return true;
}

/**
 * Get entry count by type
 */
export function countByType(root?: string): { summaries: number; entries: number } {
  const kbRoot = root ?? findRoot();
  const index = getIndex(kbRoot);
  
  let summaries = 0;
  let entries = 0;
  
  for (const entry of Object.values(index.entries)) {
    if (entry.type === 'summary') {
      summaries++;
    } else {
      entries++;
    }
  }
  
  return { summaries, entries };
}
