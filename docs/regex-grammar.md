# Portable regex grammar

`dossierProhibition.regex` uses a deliberately restricted regex grammar so
that the same pattern compiles to the *same matching behavior* under both
JavaScript's `RegExp` (this repository) and Python's `re` module (the Scout
consumer), rather than merely "both happen to compile". Successful
compilation under both engines does not imply identical syntax or match
semantics — that's exactly the gap this grammar closes.

The parser lives at `packages/core/src/regex/portable-regex.ts`; the compiler
(portable AST -> native `RegExp`) lives at `packages/core/src/regex/compile.ts`.

## Allowed

- Literal code points, including astral (non-BMP) characters typed directly.
- Backslash-escaped regex punctuation: `\ ^ $ . | ? * + ( ) [ ] { } /` (and
  `-` inside a character class). Escaping anything else is rejected — see
  "Rejected" below.
- `.` (any character; see the `s` flag for line-terminator behavior).
- Character classes `[...]` and negated classes `[^...]`, with simple ranges
  (`a-z`, `0-9`). Class intersection/subtraction (e.g. `[a-z&&[^aeiou]]`) has
  no special meaning in this grammar — such sequences just parse as literal
  characters, which is itself a form of rejection-by-omission.
- `^` and `$` anchors.
- Capturing groups `(...)` and non-capturing groups `(?:...)`.
- Alternation `|`.
- Greedy and lazy quantifiers: `*`, `+`, `?`, `{m}`, `{m,}`, `{m,n}`, each
  optionally followed by `?` for the lazy variant.

## Rejected

Each of these is rejected because its syntax or semantics diverge between
ECMAScript and Python, or because it has no well-defined portable meaning:

- Lookahead/lookbehind: `(?=`, `(?!`, `(?<=`, `(?<!`.
- Backreferences, numeric or named: `\1`, `\k<name>`.
- Named groups: `(?<name>...)`, `(?P<name>...)`.
- Inline flags: `(?i)`, `(?i:...)`.
- Shorthand classes: `\d`, `\D`, `\s`, `\S`, `\w`, `\W`.
- Unicode property escapes: `\p{...}`, `\P{...}`.
- Control and hexadecimal escapes: `\xHH`, `\uHHHH`, `\cX` (write the literal
  character instead — YAML/JSON both support raw UTF-8 text).
- Conditionals: `(?(1)yes|no)`.
- Comments: `(?#comment)`.
- Atomic groups: `(?>...)`.
- Possessive quantifiers: `a*+`, `a++`, `a?+`, `a{1,2}+`.
- Word boundaries (`\b`, `\B`) and any other unrecognized escape.
- Any other unrecognized `(?...)` construct.

Any of these causes `parsePortableRegex` to throw `PortableRegexError` with
the offending code-point offset; the semantic validator surfaces this as a
`Portable regex rejected: ...` validation error.

## Flags

Only `i`, `m`, and `s` are permitted, each at most once, in any authored
order — 16 valid strings in total (including the empty string for no flags):
`""`, `i`, `m`, `s`, `im`, `is`, `mi`, `ms`, `si`, `sm`, `ims`, `ism`, `mis`,
`msi`, `sim`, `smi`. This is a closed schema enum
(`dossierProhibition.properties.flags.enum`), so an unsupported letter or a
repeated letter is rejected structurally, before any regex code runs.

- **`m`** and **`s`** pass straight through as native `m`/`s` flags on the
  compiled `RegExp`. Their semantics already agree with Python's
  `re.MULTILINE` / `re.DOTALL` once the subject has been line-normalized to
  LF (see [unicode-normalization.md](./unicode-normalization.md)).
- **`i`** is *not* passed as a native flag. JavaScript and Python disagree on
  Unicode case-insensitive equivalence tables, so authored `i` is implemented
  as **ASCII-only case folding**: the compiler folds every ASCII letter
  (`A-Z`/`a-z`) in the pattern's literals and character-class items to
  lowercase, the matching subject is separately ASCII-folded the same way
  (`asciiFold` in `compile.ts`), and the native `i` flag is never set. Only
  `A-Z` fold to `a-z`; every other code point, including non-ASCII letters,
  passes through untouched — deterministic and identical in both languages.

## Matching semantics

`dossierProhibition.regex` is always a **search**, not a full match, against
the line-normalized original text (see
[unicode-normalization.md](./unicode-normalization.md) for line normalization).
Patterns are compiled with the Unicode (`u`) flag so astral literals behave as
single code points, matching Python's native code-point semantics.
