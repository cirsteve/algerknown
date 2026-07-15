/**
 * Portable regex grammar: an allowlist subset of regex syntax that compiles
 * identically (as a search, not a full match) under both JavaScript's RegExp
 * and Python's `re` module. Rejects anything whose syntax or semantics differ
 * between the two engines, rather than relying on "both happen to compile".
 *
 * Allowed: literal code points, backslash-escaped regex punctuation, `.`,
 * positive/negated character classes with simple ranges, `^`/`$` anchors,
 * capturing groups `(...)`, non-capturing groups `(?:...)`, alternation `|`,
 * and greedy/lazy quantifiers `*`, `+`, `?`, `{m}`, `{m,}`, `{m,n}`.
 *
 * Rejected: lookaround, backreferences (numeric or named), named groups,
 * inline flags, comments, atomic groups, possessive quantifiers, shorthand
 * classes (`\d`, `\s`, `\w`, ...), Unicode property escapes (`\p{...}`),
 * control/hex escapes, conditionals, and any other unrecognized `(?` construct.
 */

export class PortableRegexError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} (at code point offset ${position})`);
    this.name = 'PortableRegexError';
  }
}

// Characters that may be backslash-escaped to mean themselves. This is the
// entire escape vocabulary of the portable grammar — anything else (letters,
// digits, other punctuation) after a backslash is rejected.
const ESCAPABLE_PUNCTUATION = new Set([
  '\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}', '/',
]);

// Additional characters that are meaningful only inside a character class and
// may also be escaped there to mean themselves literally.
const CLASS_ESCAPABLE_EXTRA = new Set(['-']);

export interface LiteralNode { kind: 'literal'; cp: number }
export interface DotNode { kind: 'dot' }
export interface AnchorNode { kind: 'anchor'; type: 'start' | 'end' }
export type ClassItem =
  | { type: 'char'; cp: number }
  | { type: 'range'; from: number; to: number };
export interface ClassNode { kind: 'class'; negate: boolean; items: ClassItem[] }
export interface GroupNode { kind: 'group'; capturing: boolean; body: AlternationNode }
export interface QuantNode { kind: 'quant'; node: AstNode; min: number; max: number | null; lazy: boolean }
export interface ConcatNode { kind: 'concat'; parts: AstNode[] }
export interface AlternationNode { kind: 'alt'; options: ConcatNode[] }

export type AstNode =
  | LiteralNode
  | DotNode
  | AnchorNode
  | ClassNode
  | GroupNode
  | QuantNode
  | ConcatNode
  | AlternationNode;

class Parser {
  private readonly cps: string[];
  private pos = 0;

  constructor(pattern: string) {
    // Iterate by Unicode code point (not UTF-16 code unit) so astral literals
    // are treated as single atoms.
    this.cps = Array.from(pattern);
  }

  parse(): AlternationNode {
    const node = this.parseAlternation();
    if (this.pos !== this.cps.length) {
      throw new PortableRegexError(`Unexpected character "${this.peek()}"`, this.pos);
    }
    return node;
  }

  private peek(offset = 0): string | undefined {
    return this.cps[this.pos + offset];
  }

  private atEnd(): boolean {
    return this.pos >= this.cps.length;
  }

  private advance(): string {
    const c = this.cps[this.pos];
    this.pos++;
    return c;
  }

  private expect(c: string): void {
    if (this.peek() !== c) {
      throw new PortableRegexError(`Expected "${c}" but found "${this.peek() ?? '<end>'}"`, this.pos);
    }
    this.pos++;
  }

  private parseAlternation(): AlternationNode {
    const options: ConcatNode[] = [this.parseConcat()];
    while (this.peek() === '|') {
      this.advance();
      options.push(this.parseConcat());
    }
    return { kind: 'alt', options };
  }

  private parseConcat(): ConcatNode {
    const parts: AstNode[] = [];
    while (!this.atEnd() && this.peek() !== '|' && this.peek() !== ')') {
      parts.push(this.parseQuantified());
    }
    return { kind: 'concat', parts };
  }

  private parseQuantified(): AstNode {
    const atom = this.parseAtom();
    const quant = this.tryParseQuantifierSuffix();
    if (!quant) return atom;

    // A quantifier (or lazy marker) directly followed by another quantifier
    // marker is a stacked/possessive-style construct neither engine supports
    // uniformly (e.g. `a*+`, `a??`, `a{1,2}+`).
    if (this.peek() === '*' || this.peek() === '+' || this.peek() === '?') {
      throw new PortableRegexError(
        'Quantifier cannot be repeated (possessive quantifiers are not supported)',
        this.pos
      );
    }

    return { kind: 'quant', node: atom, min: quant.min, max: quant.max, lazy: quant.lazy };
  }

  private tryParseQuantifierSuffix(): { min: number; max: number | null; lazy: boolean } | null {
    const c = this.peek();
    let min: number;
    let max: number | null;

    if (c === '*') {
      this.advance();
      min = 0;
      max = null;
    } else if (c === '+') {
      this.advance();
      min = 1;
      max = null;
    } else if (c === '?') {
      this.advance();
      min = 0;
      max = 1;
    } else if (c === '{') {
      const saved = this.pos;
      const parsed = this.tryParseBraceQuantifier();
      if (!parsed) {
        this.pos = saved;
        return null;
      }
      min = parsed.min;
      max = parsed.max;
    } else {
      return null;
    }

    let lazy = false;
    if (this.peek() === '?') {
      this.advance();
      lazy = true;
    }
    return { min, max, lazy };
  }

  private tryParseBraceQuantifier(): { min: number; max: number | null } | null {
    // '{' already peeked, not consumed.
    this.advance(); // consume '{'
    const minDigits = this.readDigits();
    if (minDigits === '') {
      return null;
    }
    const min = parseInt(minDigits, 10);

    if (this.peek() === '}') {
      this.advance();
      return { min, max: min };
    }

    if (this.peek() === ',') {
      this.advance();
      const maxDigits = this.readDigits();
      if (this.peek() !== '}') {
        return null;
      }
      this.advance();
      if (maxDigits === '') {
        return { min, max: null };
      }
      const max = parseInt(maxDigits, 10);
      if (max < min) {
        throw new PortableRegexError(`Quantifier range {${min},${max}} has max < min`, this.pos);
      }
      return { min, max };
    }

    return null;
  }

  private readDigits(): string {
    let s = '';
    while (!this.atEnd() && /^[0-9]$/.test(this.peek()!)) {
      s += this.advance();
    }
    return s;
  }

  private parseAtom(): AstNode {
    if (this.atEnd()) {
      throw new PortableRegexError('Unexpected end of pattern', this.pos);
    }
    const c = this.peek()!;

    if (c === '(') return this.parseGroup();
    if (c === '[') return this.parseClass();
    if (c === '.') {
      this.advance();
      return { kind: 'dot' };
    }
    if (c === '^') {
      this.advance();
      return { kind: 'anchor', type: 'start' };
    }
    if (c === '$') {
      this.advance();
      return { kind: 'anchor', type: 'end' };
    }
    if (c === '\\') {
      return { kind: 'literal', cp: this.parseEscape(ESCAPABLE_PUNCTUATION) };
    }
    if (c === '{' || c === '}' || c === ']' || c === ')' || c === '*' || c === '+' || c === '?') {
      throw new PortableRegexError(
        `"${c}" must be escaped to be used literally`,
        this.pos
      );
    }

    this.advance();
    return { kind: 'literal', cp: c.codePointAt(0)! };
  }

  private parseEscape(allowed: Set<string>): number {
    const backslashPos = this.pos;
    this.advance(); // consume '\'
    if (this.atEnd()) {
      throw new PortableRegexError('Dangling escape at end of pattern', backslashPos);
    }
    const next = this.advance();
    if (!allowed.has(next)) {
      throw new PortableRegexError(
        `Unsupported escape "\\${next}" — only regex punctuation may be escaped in the portable grammar`,
        backslashPos
      );
    }
    return next.codePointAt(0)!;
  }

  private parseGroup(): GroupNode {
    this.expect('(');
    let capturing = true;
    if (this.peek() === '?') {
      if (this.peek(1) === ':') {
        this.advance();
        this.advance();
        capturing = false;
      } else {
        throw new PortableRegexError(
          `Unsupported group construct "(?${this.peek(1) ?? ''}" — only (?:...) non-capturing groups are supported`,
          this.pos
        );
      }
    }
    const body = this.parseAlternation();
    this.expect(')');
    return { kind: 'group', capturing, body };
  }

  private parseClass(): ClassNode {
    this.expect('[');
    let negate = false;
    if (this.peek() === '^') {
      this.advance();
      negate = true;
    }
    const items: ClassItem[] = [];
    while (true) {
      if (this.atEnd()) {
        throw new PortableRegexError('Unterminated character class', this.pos);
      }
      if (this.peek() === ']') {
        this.advance();
        break;
      }
      const cp = this.readClassAtomCodePoint();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.advance(); // consume '-'
        const to = this.readClassAtomCodePoint();
        if (to < cp) {
          throw new PortableRegexError(`Character class range out of order: ${cp}-${to}`, this.pos);
        }
        items.push({ type: 'range', from: cp, to });
      } else {
        items.push({ type: 'char', cp });
      }
    }
    if (items.length === 0) {
      throw new PortableRegexError('Character class must not be empty', this.pos);
    }
    return { kind: 'class', negate, items };
  }

  private readClassAtomCodePoint(): number {
    if (this.peek() === '\\') {
      const allowed = new Set([...ESCAPABLE_PUNCTUATION, ...CLASS_ESCAPABLE_EXTRA]);
      return this.parseEscape(allowed);
    }
    const c = this.advance();
    return c.codePointAt(0)!;
  }
}

/** Parse a portable regex pattern into an AST, throwing PortableRegexError on any disallowed construct. */
export function parsePortableRegex(pattern: string): AlternationNode {
  return new Parser(pattern).parse();
}
