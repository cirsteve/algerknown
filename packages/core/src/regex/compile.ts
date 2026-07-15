/**
 * Compiles a portable-regex AST into a native JavaScript RegExp.
 *
 * Authored `m` and `s` flags pass straight through to the host engine (their
 * semantics already agree with Python's `re.MULTILINE`/`re.DOTALL` once the
 * subject has been line-normalized to LF). Authored `i` does NOT become the
 * native `i` flag: JS and Python disagree on Unicode case-insensitive
 * equivalence tables, so `i` is implemented as ASCII-only case folding —
 * applied to both the pattern's literal/class ASCII letters and the subject
 * — with the native flag omitted entirely.
 */

import { parsePortableRegex, type AstNode, type AlternationNode, type ClassItem } from './portable-regex.js';

const ASCII_UPPER_A = 0x41;
const ASCII_UPPER_Z = 0x5a;

function isAsciiUpper(cp: number): boolean {
  return cp >= ASCII_UPPER_A && cp <= ASCII_UPPER_Z;
}

function toAsciiLower(cp: number): number {
  return isAsciiUpper(cp) ? cp + 32 : cp;
}

/** ASCII-only lowercasing: folds A-Z to a-z and leaves every other code point untouched. */
export function asciiFold(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    out += isAsciiUpper(cp) ? String.fromCodePoint(cp + 32) : ch;
  }
  return out;
}

function foldClassItem(item: ClassItem): ClassItem {
  if (item.type === 'char') {
    return { type: 'char', cp: toAsciiLower(item.cp) };
  }
  return { type: 'range', from: toAsciiLower(item.from), to: toAsciiLower(item.to) };
}

/** Recursively ASCII-fold literal/class nodes so the pattern matches an ASCII-folded subject. */
function foldNode(node: AstNode): AstNode {
  switch (node.kind) {
    case 'literal':
      return { kind: 'literal', cp: toAsciiLower(node.cp) };
    case 'class':
      return { kind: 'class', negate: node.negate, items: node.items.map(foldClassItem) };
    case 'dot':
    case 'anchor':
      return node;
    case 'group':
      return { kind: 'group', capturing: node.capturing, body: foldAlternation(node.body) };
    case 'quant':
      return { kind: 'quant', node: foldNode(node.node), min: node.min, max: node.max, lazy: node.lazy };
    case 'concat':
      return { kind: 'concat', parts: node.parts.map(foldNode) };
    case 'alt':
      return foldAlternation(node);
  }
}

function foldAlternation(alt: AlternationNode): AlternationNode {
  return { kind: 'alt', options: alt.options.map(c => ({ kind: 'concat', parts: c.parts.map(foldNode) })) };
}

// Characters that are metacharacters in a JS RegExp literal outside a class.
const JS_META = new Set(['\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}']);
// Characters that are metacharacters inside a JS RegExp character class.
const JS_CLASS_META = new Set(['\\', ']', '^', '-']);

function emitLiteralChar(cp: number, metaSet: Set<string>): string {
  const ch = String.fromCodePoint(cp);
  return metaSet.has(ch) ? `\\${ch}` : ch;
}

function emitClassItem(item: ClassItem): string {
  if (item.type === 'char') {
    return emitLiteralChar(item.cp, JS_CLASS_META);
  }
  return `${emitLiteralChar(item.from, JS_CLASS_META)}-${emitLiteralChar(item.to, JS_CLASS_META)}`;
}

function emitNode(node: AstNode): string {
  switch (node.kind) {
    case 'literal':
      return emitLiteralChar(node.cp, JS_META);
    case 'dot':
      return '.';
    case 'anchor':
      return node.type === 'start' ? '^' : '$';
    case 'class':
      return `[${node.negate ? '^' : ''}${node.items.map(emitClassItem).join('')}]`;
    case 'group':
      return node.capturing ? `(${emitAlternation(node.body)})` : `(?:${emitAlternation(node.body)})`;
    case 'quant': {
      const inner = emitNode(node.node);
      const wrapped = node.node.kind === 'concat' || node.node.kind === 'alt' ? `(?:${inner})` : inner;
      return `${wrapped}${emitQuantifier(node.min, node.max)}${node.lazy ? '?' : ''}`;
    }
    case 'concat':
      return node.parts.map(emitNode).join('');
    case 'alt':
      return emitAlternation(node);
  }
}

function emitAlternation(alt: AlternationNode): string {
  return alt.options.map(c => c.parts.map(emitNode).join('')).join('|');
}

function emitQuantifier(min: number, max: number | null): string {
  if (min === 0 && max === null) return '*';
  if (min === 1 && max === null) return '+';
  if (min === 0 && max === 1) return '?';
  if (max === null) return `{${min},}`;
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

export interface PortableRegexFlags {
  i?: boolean;
  m?: boolean;
  s?: boolean;
}

export interface CompiledPortableRegex {
  regex: RegExp;
  /** Whether the subject must be ASCII-folded before matching (authored `i`). */
  foldSubject: boolean;
}

/** Parse + compile a portable regex pattern into a host RegExp ready for `.test()`/`.exec()`. */
export function compilePortableRegex(pattern: string, flags: PortableRegexFlags = {}): CompiledPortableRegex {
  const ast = parsePortableRegex(pattern);
  const effectiveAst = flags.i ? foldAlternation(ast) : ast;
  const source = emitAlternation(effectiveAst);

  let nativeFlags = 'u';
  if (flags.m) nativeFlags += 'm';
  if (flags.s) nativeFlags += 's';

  return {
    regex: new RegExp(source, nativeFlags),
    foldSubject: Boolean(flags.i),
  };
}
