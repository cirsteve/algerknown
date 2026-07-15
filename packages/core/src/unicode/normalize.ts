/**
 * Canonical phrase normalization for dossier matching.
 *
 * Order (fixed, per contract): CRLF/CR -> LF, Unicode NFKC, full Unicode case
 * folding (vendored, C+F statuses only), collapse maximal White_Space runs to a
 * single U+0020, trim leading/trailing U+0020.
 */

import { CASEFOLD_DATA, CASEFOLD_UNICODE_VERSION } from './casefold-data.js';
import { WHITE_SPACE_RANGES, WHITE_SPACE_UNICODE_VERSION } from './whitespace-data.js';

export const NORMALIZATION_UNICODE_VERSION = CASEFOLD_UNICODE_VERSION;

if (CASEFOLD_UNICODE_VERSION !== WHITE_SPACE_UNICODE_VERSION) {
  throw new Error(
    `Vendored Unicode data version mismatch: casefold=${CASEFOLD_UNICODE_VERSION} whitespace=${WHITE_SPACE_UNICODE_VERSION}`
  );
}

const CASEFOLD_MAP: ReadonlyMap<number, readonly number[]> = new Map(CASEFOLD_DATA);

/** Binary search over the sorted, non-overlapping White_Space range table. */
export function isUnicodeWhiteSpace(codePoint: number): boolean {
  let lo = 0;
  let hi = WHITE_SPACE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = WHITE_SPACE_RANGES[mid];
    if (codePoint < start) {
      hi = mid - 1;
    } else if (codePoint > end) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/** Apply the vendored Unicode 15.0.0 full case-fold mapping (C+F statuses). */
export function fullCaseFold(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    const mapped = CASEFOLD_MAP.get(cp);
    if (mapped) {
      for (const mcp of mapped) {
        out += String.fromCodePoint(mcp);
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Replace CRLF and bare CR with LF, and collapse U+2028/U+2029 line separators to LF. */
export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n|\r|\u2028|\u2029/g, '\n');
}

/**
 * Canonical phrase normalization used for `normalized_phrase` prohibition
 * matching and duplicate-phrasing detection.
 */
export function canonicalNormalize(input: string): string {
  const lineNormalized = input.replace(/\r\n|\r/g, '\n');
  const nfkc = lineNormalized.normalize('NFKC');
  const folded = fullCaseFold(nfkc);

  let collapsed = '';
  let inWhitespaceRun = false;
  for (const ch of folded) {
    const cp = ch.codePointAt(0)!;
    if (isUnicodeWhiteSpace(cp)) {
      if (!inWhitespaceRun) {
        collapsed += ' ';
        inWhitespaceRun = true;
      }
    } else {
      collapsed += ch;
      inWhitespaceRun = false;
    }
  }

  return collapsed.replace(/^ +| +$/g, '');
}

/**
 * Line-normalize a subject for portable-regex matching: CRLF, bare CR, U+2028,
 * and U+2029 all become LF. Distinct from canonicalNormalize (no casefold/NFKC).
 */
export function normalizeSubjectForRegex(input: string): string {
  return normalizeLineEndings(input);
}
