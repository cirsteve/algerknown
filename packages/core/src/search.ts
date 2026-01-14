/**
 * Search Module
 * Full-text search and tag filtering across entries
 */

import type { AnyEntry, SearchResult } from './types.js';
import { readAllEntries } from './store.js';
import { findRoot } from './config.js';
import { isSummary, isEntry } from './types.js';

/**
 * Extract searchable text from an entry
 */
function extractSearchableText(entry: AnyEntry): string {
  const parts: string[] = [
    entry.id,
    entry.topic,
  ];
  
  if (entry.tags) {
    parts.push(...entry.tags);
  }
  
  if (isSummary(entry)) {
    parts.push(entry.summary);
    
    if (entry.learnings) {
      for (const learning of entry.learnings) {
        parts.push(learning.insight);
        if (learning.context) parts.push(learning.context);
      }
    }
    
    if (entry.decisions) {
      for (const decision of entry.decisions) {
        parts.push(decision.decision);
        if (decision.rationale) parts.push(decision.rationale);
        if (decision.trade_offs) parts.push(decision.trade_offs);
      }
    }
    
    if (entry.open_questions) {
      parts.push(...entry.open_questions);
    }
  }
  
  if (isEntry(entry)) {
    if (entry.context) parts.push(entry.context);
    if (entry.approach) parts.push(entry.approach);
    
    if (entry.outcome) {
      if (entry.outcome.worked) parts.push(...entry.outcome.worked);
      if (entry.outcome.failed) parts.push(...entry.outcome.failed);
      if (entry.outcome.surprised) parts.push(...entry.outcome.surprised);
    }
  }
  
  return parts.join(' ').toLowerCase();
}

/**
 * Extract a snippet around the first match
 */
function extractSnippet(text: string, query: string, contextLength: number = 50): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  
  if (index === -1) {
    // Return beginning of text if no match
    return text.slice(0, contextLength * 2) + (text.length > contextLength * 2 ? '...' : '');
  }
  
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);
  
  let snippet = text.slice(start, end);
  
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}

/**
 * Calculate a simple relevance score
 */
function calculateScore(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);
  
  let score = 0;
  
  // Exact phrase match bonus
  if (lowerText.includes(lowerQuery)) {
    score += 10;
  }
  
  // Individual word matches
  for (const word of words) {
    if (lowerText.includes(word)) {
      score += 1;
      
      // Title/topic match bonus
      if (lowerText.indexOf(word) < 100) {
        score += 2;
      }
    }
  }
  
  // Count occurrences
  const regex = new RegExp(lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = text.match(regex);
  if (matches) {
    score += Math.min(matches.length, 5); // Cap at 5 extra points
  }
  
  return score;
}

/**
 * Search across all entries
 * 
 * @param query - Search query (case-insensitive substring match)
 * @param root - Knowledge base root (optional)
 * @returns Sorted array of search results
 */
export function search(query: string, root?: string): SearchResult[] {
  if (!query.trim()) {
    return [];
  }
  
  const kbRoot = root ?? findRoot();
  const entries = readAllEntries(kbRoot);
  const results: SearchResult[] = [];
  
  for (const entry of entries) {
    const searchText = extractSearchableText(entry);
    
    if (searchText.includes(query.toLowerCase())) {
      const score = calculateScore(searchText, query);
      
      // Get snippet from most relevant field
      let snippetSource = entry.topic;
      if (isSummary(entry)) {
        snippetSource = entry.summary;
      } else if (isEntry(entry) && entry.context) {
        snippetSource = entry.context;
      }
      
      results.push({
        id: entry.id,
        type: entry.type,
        topic: entry.topic,
        snippet: extractSnippet(snippetSource, query),
        score,
      });
    }
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return results;
}

/**
 * Filter entries by tag
 * 
 * @param tag - Tag to filter by (case-insensitive)
 * @param root - Knowledge base root (optional)
 * @returns Array of matching entries
 */
export function filterByTag(tag: string, root?: string): AnyEntry[] {
  const kbRoot = root ?? findRoot();
  const entries = readAllEntries(kbRoot);
  const lowerTag = tag.toLowerCase();
  
  return entries.filter(entry => {
    if (!entry.tags) return false;
    return entry.tags.some(t => t.toLowerCase() === lowerTag);
  });
}

/**
 * Get all unique tags across entries
 * 
 * @param root - Knowledge base root (optional)
 * @returns Sorted array of unique tags with counts
 */
export function getAllTags(root?: string): Array<{ tag: string; count: number }> {
  const kbRoot = root ?? findRoot();
  const entries = readAllEntries(kbRoot);
  const tagCounts = new Map<string, number>();
  
  for (const entry of entries) {
    if (!entry.tags) continue;
    
    for (const tag of entry.tags) {
      const lower = tag.toLowerCase();
      tagCounts.set(lower, (tagCounts.get(lower) ?? 0) + 1);
    }
  }
  
  const result = Array.from(tagCounts.entries()).map(([tag, count]) => ({
    tag,
    count,
  }));
  
  result.sort((a, b) => b.count - a.count);
  
  return result;
}

/**
 * Filter entries by status
 * 
 * @param status - Status to filter by
 * @param root - Knowledge base root (optional)
 * @returns Array of matching entries
 */
export function filterByStatus(
  status: 'active' | 'archived' | 'reference' | 'blocked' | 'planned',
  root?: string
): AnyEntry[] {
  const kbRoot = root ?? findRoot();
  const entries = readAllEntries(kbRoot);
  
  return entries.filter(entry => entry.status === status);
}

/**
 * Filter entries by type
 * 
 * @param type - Entry type ('summary' or 'entry')
 * @param root - Knowledge base root (optional)
 * @returns Array of matching entries
 */
export function filterByType(
  type: 'summary' | 'entry',
  root?: string
): AnyEntry[] {
  const kbRoot = root ?? findRoot();
  const entries = readAllEntries(kbRoot);
  
  return entries.filter(entry => entry.type === type);
}
