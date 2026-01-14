/**
 * Algerknown Core Types
 * Type definitions for summaries, entries, index, and links
 */

// ============== Status ==============

export type Status = 'active' | 'archived' | 'reference' | 'blocked' | 'planned';

// ============== Relationships ==============

export type Relationship =
  | 'evolved_into'
  | 'evolved_from'
  | 'informs'
  | 'informed_by'
  | 'part_of'
  | 'contains'
  | 'blocked_by'
  | 'blocks'
  | 'supersedes'
  | 'superseded_by'
  | 'references'
  | 'referenced_by'
  | 'depends_on'
  | 'dependency_of'
  | 'enables'
  | 'enabled_by';

// ============== Links ==============

export interface Link {
  id: string;
  relationship: Relationship;
  notes?: string;
}

// ============== Resources ==============

export interface Resource {
  url: string;
  title?: string;
  notes?: string;
}

// ============== Date Range ==============

export interface DateRange {
  start: string; // YYYY, YYYY-MM, or YYYY-MM-DD
  end?: string;
}

// ============== Learning ==============

export interface Learning {
  insight: string;
  context?: string;
  relevance?: string[];
}

// ============== Decision ==============

export interface Decision {
  decision: string;
  rationale?: string;
  trade_offs?: string;
  date?: string;
  superseded_by?: string;
}

// ============== Artifact ==============

export interface Artifact {
  repo?: string;
  path: string;
  notes?: string;
  commit?: string;
}

// ============== Outcome ==============

export interface Outcome {
  worked?: string[];
  failed?: string[];
  surprised?: string[];
}

// ============== Summary ==============

export interface Summary {
  id: string;
  type: 'summary';
  topic: string;
  date_range?: DateRange;
  status: Status;
  tags?: string[];
  summary: string;
  learnings?: Learning[];
  decisions?: Decision[];
  artifacts?: Artifact[];
  open_questions?: string[];
  resources?: Resource[];
  links?: Link[];
}

// ============== Entry (Journal) ==============

export interface Entry {
  id: string;
  type: 'entry';
  date: string; // YYYY-MM-DD
  topic: string;
  status: Status;
  tags?: string[];
  time_hours?: number;
  context?: string;
  approach?: string;
  outcome?: Outcome;
  commits?: string[];
  resources?: Resource[];
  links?: Link[];
}

// ============== Union Type ==============

export type AnyEntry = Summary | Entry;

// ============== Index ==============

export interface IndexEntry {
  path: string;
  type: 'summary' | 'entry';
}

export interface Index {
  version: string;
  entries: Record<string, IndexEntry>;
}

// ============== Validation ==============

export interface ValidationError {
  path: string;
  message: string;
  keyword?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============== Search ==============

export interface SearchResult {
  id: string;
  type: 'summary' | 'entry';
  topic: string;
  snippet: string;
  score: number;
}

// ============== Type Guards ==============

export function isSummary(entry: AnyEntry): entry is Summary {
  return entry.type === 'summary';
}

export function isEntry(entry: AnyEntry): entry is Entry {
  return entry.type === 'entry';
}
