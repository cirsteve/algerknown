/**
 * Linker Module
 * Manage relationships between entries
 */

import type { AnyEntry, Link, Relationship } from './types.js';
import { readEntry, writeEntry, readAllEntries } from './store.js';
import { findRoot } from './config.js';

/**
 * Inverse relationship mapping
 * When A "informs" B, then B is "informed_by" A
 */
const INVERSE_RELATIONSHIPS: Record<Relationship, Relationship> = {
  'evolved_into': 'evolved_from',
  'evolved_from': 'evolved_into',
  'informs': 'informed_by',
  'informed_by': 'informs',
  'part_of': 'contains',
  'contains': 'part_of',
  'blocked_by': 'blocks',
  'blocks': 'blocked_by',
  'supersedes': 'superseded_by',
  'superseded_by': 'supersedes',
  'references': 'referenced_by',
  'referenced_by': 'references',
  'depends_on': 'dependency_of',
  'dependency_of': 'depends_on',
  'enables': 'enabled_by',
  'enabled_by': 'enables',
};

/**
 * Get the inverse of a relationship
 */
export function getInverseRelationship(rel: Relationship): Relationship {
  return INVERSE_RELATIONSHIPS[rel];
}

/**
 * Add a link from one entry to another
 * 
 * @param fromId - Source entry ID
 * @param toId - Target entry ID
 * @param relationship - How fromId relates to toId
 * @param notes - Optional notes about the relationship
 * @param root - Knowledge base root (optional)
 * @returns true if link was added, false if already exists
 */
export function addLink(
  fromId: string,
  toId: string,
  relationship: Relationship,
  notes?: string,
  root?: string
): boolean {
  const kbRoot = root ?? findRoot();
  
  // Read source entry
  const entry = readEntry(fromId, kbRoot);
  if (!entry) {
    throw new Error(`Entry not found: ${fromId}`);
  }
  
  // Check target exists
  const target = readEntry(toId, kbRoot);
  if (!target) {
    throw new Error(`Target entry not found: ${toId}`);
  }
  
  // Initialize links array if needed
  if (!entry.links) {
    entry.links = [];
  }
  
  // Check if link already exists
  const existingLink = entry.links.find(
    l => l.id === toId && l.relationship === relationship
  );
  
  if (existingLink) {
    return false; // Link already exists
  }
  
  // Add the link
  const newLink: Link = { id: toId, relationship };
  if (notes) {
    newLink.notes = notes;
  }
  
  entry.links.push(newLink);
  writeEntry(entry, kbRoot);
  
  return true;
}

/**
 * Remove a link from one entry to another
 * 
 * @param fromId - Source entry ID
 * @param toId - Target entry ID
 * @param relationship - Optional: only remove links with this relationship
 * @param root - Knowledge base root (optional)
 * @returns Number of links removed
 */
export function removeLink(
  fromId: string,
  toId: string,
  relationship?: Relationship,
  root?: string
): number {
  const kbRoot = root ?? findRoot();
  
  const entry = readEntry(fromId, kbRoot);
  if (!entry || !entry.links) {
    return 0;
  }
  
  const originalLength = entry.links.length;
  
  entry.links = entry.links.filter(l => {
    if (l.id !== toId) return true;
    if (relationship && l.relationship !== relationship) return true;
    return false;
  });
  
  const removed = originalLength - entry.links.length;
  
  if (removed > 0) {
    writeEntry(entry, kbRoot);
  }
  
  return removed;
}

/**
 * Get all links FROM an entry
 * 
 * @param id - Entry ID
 * @param root - Knowledge base root (optional)
 * @returns Array of links
 */
export function getLinks(id: string, root?: string): Link[] {
  const kbRoot = root ?? findRoot();
  
  const entry = readEntry(id, kbRoot);
  if (!entry) {
    return [];
  }
  
  return entry.links ?? [];
}

/**
 * Get all backlinks TO an entry (links from other entries pointing here)
 * This requires scanning all entries
 * 
 * @param id - Entry ID
 * @param root - Knowledge base root (optional)
 * @returns Array of {fromId, link} objects
 */
export function getBacklinks(
  id: string, 
  root?: string
): Array<{ fromId: string; link: Link }> {
  const kbRoot = root ?? findRoot();
  
  const allEntries = readAllEntries(kbRoot);
  const backlinks: Array<{ fromId: string; link: Link }> = [];
  
  for (const entry of allEntries) {
    if (!entry.links) continue;
    
    for (const link of entry.links) {
      if (link.id === id) {
        backlinks.push({
          fromId: entry.id,
          link: {
            id: entry.id,
            relationship: getInverseRelationship(link.relationship),
            notes: link.notes,
          },
        });
      }
    }
  }
  
  return backlinks;
}

/**
 * Get all linked entries (both directions) with resolved entry data
 * 
 * @param id - Entry ID
 * @param root - Knowledge base root (optional)
 * @returns Object with outgoing and incoming links
 */
export function getRelatedEntries(id: string, root?: string): {
  outgoing: Array<{ entry: AnyEntry; relationship: Relationship; notes?: string }>;
  incoming: Array<{ entry: AnyEntry; relationship: Relationship; notes?: string }>;
} {
  const kbRoot = root ?? findRoot();
  
  const outgoing: Array<{ entry: AnyEntry; relationship: Relationship; notes?: string }> = [];
  const incoming: Array<{ entry: AnyEntry; relationship: Relationship; notes?: string }> = [];
  
  // Get outgoing links
  const links = getLinks(id, kbRoot);
  for (const link of links) {
    const entry = readEntry(link.id, kbRoot);
    if (entry) {
      outgoing.push({
        entry,
        relationship: link.relationship,
        notes: link.notes,
      });
    }
  }
  
  // Get incoming links (backlinks)
  const backlinks = getBacklinks(id, kbRoot);
  for (const { link } of backlinks) {
    const entry = readEntry(link.id, kbRoot);
    if (entry) {
      incoming.push({
        entry,
        relationship: link.relationship,
        notes: link.notes,
      });
    }
  }
  
  return { outgoing, incoming };
}

/**
 * Check if a link exists
 */
export function hasLink(
  fromId: string,
  toId: string,
  relationship?: Relationship,
  root?: string
): boolean {
  const kbRoot = root ?? findRoot();
  const links = getLinks(fromId, kbRoot);
  
  return links.some(l => {
    if (l.id !== toId) return false;
    if (relationship && l.relationship !== relationship) return false;
    return true;
  });
}
