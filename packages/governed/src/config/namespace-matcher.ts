import type { NamespaceId } from '../domain/ids.js';
import type { NamespacePolicyEntry, NamespaceTableConfig } from './namespace-policy.js';

export type NamespaceConfigErrorCode =
  | 'DUPLICATE_PATTERN'
  | 'INVALID_PATTERN'
  | 'UNKNOWN_ENGINE'
  | 'UNKNOWN_POLICY'
  | 'AMBIGUOUS_PATTERNS'
  | 'UNMATCHED_NAMESPACE'
  | 'AMBIGUOUS_NAMESPACE_MATCH';

export class NamespaceConfigError extends Error {
  readonly code: NamespaceConfigErrorCode;

  constructor(code: NamespaceConfigErrorCode, message: string) {
    super(message);
    this.name = 'NamespaceConfigError';
    this.code = code;
  }
}

interface PatternSegment {
  literal: boolean;
  value?: string;
}

function parsePattern(pattern: string): PatternSegment[] {
  if (pattern.length === 0) {
    throw new NamespaceConfigError('INVALID_PATTERN', 'namespace pattern must not be empty');
  }
  return pattern.split('.').map((raw) => {
    if (raw.length === 0) {
      throw new NamespaceConfigError('INVALID_PATTERN', `namespace pattern "${pattern}" has an empty segment`);
    }
    if (raw === '*') {
      return { literal: false };
    }
    if (raw.includes('*')) {
      throw new NamespaceConfigError(
        'INVALID_PATTERN',
        `namespace pattern "${pattern}" has a partially-wildcarded segment "${raw}"; a segment must be a literal or exactly "*"`,
      );
    }
    return { literal: true, value: raw };
  });
}

/** Trailing '*' matches one-or-more remaining segments; a mid-pattern '*' matches exactly one segment. */
function isRestWildcard(segments: PatternSegment[], index: number): boolean {
  return !segments[index]!.literal && index === segments.length - 1;
}

function isExactPattern(segments: PatternSegment[]): boolean {
  return segments[segments.length - 1]!.literal;
}

function tierOf(segments: PatternSegment[]): 0 | 1 {
  return segments.some((s) => !s.literal) ? 1 : 0;
}

function literalCountOf(segments: PatternSegment[]): number {
  return segments.filter((s) => s.literal).length;
}

function matchesSegments(pattern: PatternSegment[], namespaceSegments: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (isRestWildcard(pattern, i)) {
      return namespaceSegments.length > i;
    }
    if (namespaceSegments.length <= i) {
      return false;
    }
    const seg = pattern[i]!;
    if (seg.literal && seg.value !== namespaceSegments[i]) {
      return false;
    }
  }
  return namespaceSegments.length === pattern.length;
}

function lengthsCompatible(a: PatternSegment[], b: PatternSegment[]): boolean {
  const aExact = isExactPattern(a);
  const bExact = isExactPattern(b);
  if (aExact && bExact) return a.length === b.length;
  if (aExact && !bExact) return a.length >= b.length;
  if (!aExact && bExact) return b.length >= a.length;
  return true;
}

function segmentsCompatible(a: PatternSegment[], b: PatternSegment[]): boolean {
  const minCommon = Math.min(a.length, b.length);
  for (let i = 0; i < minCommon; i++) {
    if (isRestWildcard(a, i) || isRestWildcard(b, i)) {
      return true;
    }
    const sa = a[i]!;
    const sb = b[i]!;
    if (sa.literal && sb.literal && sa.value !== sb.value) {
      return false;
    }
  }
  return true;
}

/** True if some hypothetical namespace could match both patterns with equal tier and literal count. */
function canTieAmbiguously(a: NamespacePolicyEntry, b: NamespacePolicyEntry): boolean {
  const segA = parsePattern(a.pattern);
  const segB = parsePattern(b.pattern);
  if (tierOf(segA) !== tierOf(segB)) return false;
  if (literalCountOf(segA) !== literalCountOf(segB)) return false;
  return lengthsCompatible(segA, segB) && segmentsCompatible(segA, segB);
}

export function validateNamespaceTable(table: NamespaceTableConfig): void {
  const seenPatterns = new Set<string>();
  for (const entry of table.entries) {
    if (seenPatterns.has(entry.pattern)) {
      throw new NamespaceConfigError('DUPLICATE_PATTERN', `duplicate namespace pattern "${entry.pattern}"`);
    }
    seenPatterns.add(entry.pattern);
    parsePattern(entry.pattern);
    if (!table.registeredEngines.includes(entry.engine)) {
      throw new NamespaceConfigError(
        'UNKNOWN_ENGINE',
        `namespace pattern "${entry.pattern}" references unregistered engine "${entry.engine}"`,
      );
    }
    if (!table.registeredPolicies.includes(entry.policy)) {
      throw new NamespaceConfigError(
        'UNKNOWN_POLICY',
        `namespace pattern "${entry.pattern}" references unregistered policy "${entry.policy}"`,
      );
    }
  }

  for (let i = 0; i < table.entries.length; i++) {
    for (let j = i + 1; j < table.entries.length; j++) {
      const a = table.entries[i]!;
      const b = table.entries[j]!;
      if (canTieAmbiguously(a, b)) {
        throw new NamespaceConfigError(
          'AMBIGUOUS_PATTERNS',
          `namespace patterns "${a.pattern}" and "${b.pattern}" can tie for equal specificity`,
        );
      }
    }
  }
}

interface CompiledEntry {
  entry: NamespacePolicyEntry;
  segments: PatternSegment[];
}

export class NamespaceMatcher {
  private readonly compiled: CompiledEntry[];

  constructor(table: NamespaceTableConfig) {
    validateNamespaceTable(table);
    this.compiled = table.entries.map((entry) => ({ entry, segments: parsePattern(entry.pattern) }));
  }

  resolve(namespace: NamespaceId): NamespacePolicyEntry {
    const namespaceSegments = String(namespace).split('.');
    const matches = this.compiled.filter((c) => matchesSegments(c.segments, namespaceSegments));

    if (matches.length === 0) {
      throw new NamespaceConfigError('UNMATCHED_NAMESPACE', `no namespace pattern matches "${namespace}"`);
    }

    let best = matches[0]!;
    for (const candidate of matches.slice(1)) {
      const candidateTier = tierOf(candidate.segments);
      const bestTier = tierOf(best.segments);
      if (candidateTier < bestTier) {
        best = candidate;
        continue;
      }
      if (candidateTier > bestTier) {
        continue;
      }
      const candidateSpecificity = literalCountOf(candidate.segments);
      const bestSpecificity = literalCountOf(best.segments);
      if (candidateSpecificity > bestSpecificity) {
        best = candidate;
      } else if (candidateSpecificity === bestSpecificity) {
        throw new NamespaceConfigError(
          'AMBIGUOUS_NAMESPACE_MATCH',
          `namespace "${namespace}" matches multiple equally-specific patterns`,
        );
      }
    }

    return best.entry;
  }
}
