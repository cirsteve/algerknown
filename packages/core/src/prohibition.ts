/**
 * Dossier prohibition matching: given a prohibition record and a piece of
 * text, determines whether the text matches the prohibition's matcher.
 *
 *   exact_phrase       — case-sensitive literal substring of the original text.
 *   normalized_phrase  — literal substring after canonical normalization of
 *                        both the pattern and the text (see unicode/normalize.ts).
 *   regex              — portable-regex search (not full match) on the
 *                        line-normalized original text, honoring only the
 *                        authored i/m/s flags.
 */

import { canonicalNormalize, normalizeSubjectForRegex } from './unicode/normalize.js';
import { compilePortableRegex, asciiFold } from './regex/compile.js';
import type { DossierProhibition } from './types.js';

interface ParsedFlags {
  i: boolean;
  m: boolean;
  s: boolean;
}

function parseFlags(flags: string | undefined): ParsedFlags {
  const chars = new Set((flags ?? '').split(''));
  return { i: chars.has('i'), m: chars.has('m'), s: chars.has('s') };
}

/** Evaluate a single dossier prohibition's matcher against a piece of text. */
export function matchesProhibition(prohibition: DossierProhibition, text: string): boolean {
  if (prohibition.exact_phrase !== undefined) {
    return text.includes(prohibition.exact_phrase);
  }

  if (prohibition.normalized_phrase !== undefined) {
    const normalizedText = canonicalNormalize(text);
    const normalizedPattern = canonicalNormalize(prohibition.normalized_phrase);
    return normalizedText.includes(normalizedPattern);
  }

  if (prohibition.regex !== undefined) {
    const { i, m, s } = parseFlags(prohibition.flags);
    const { regex, foldSubject } = compilePortableRegex(prohibition.regex, { i, m, s });
    const subject = normalizeSubjectForRegex(text);
    return regex.test(foldSubject ? asciiFold(subject) : subject);
  }

  throw new Error('Prohibition has no matcher (exact_phrase, normalized_phrase, or regex)');
}
