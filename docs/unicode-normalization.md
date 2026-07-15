# Unicode normalization

Two related but distinct normalization steps apply to dossier text, both
implemented in `packages/core/src/unicode/normalize.ts`.

## Canonical phrase normalization

Used for `normalized_phrase` prohibition matching and for detecting duplicate
`safe_phrasings` / `forbidden_phrasings` after normalization. Applied in this
fixed order (an explicit order avoids the lowercase-vs-casefold drift the
prior ad hoc `toLowerCase()` + whitespace-regex implementation had):

1. Replace CRLF and bare CR with LF.
2. Apply Unicode NFKC (`String.prototype.normalize('NFKC')`).
3. Apply full Unicode case folding (vendored — see below).
4. Replace every maximal run of Unicode `White_Space` code points with a
   single U+0020 space.
5. Trim leading and trailing U+0020 spaces.

Because LF (U+000A) is itself a `White_Space` code point, step 4 collapses
any line breaks introduced or left by step 1 into ordinary spaces — this is
intentional, not a bug: normalized phrases are compared as flattened text.

## Regex-subject line normalization

Used only for `regex` prohibition matching, and much narrower: CRLF, bare CR,
U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH SEPARATOR) are all replaced
with LF. No NFKC, no case folding, no whitespace collapsing — the portable
regex pattern operates on the resulting text as-is (see
[regex-grammar.md](./regex-grammar.md) for how `m`/`s` flags then interact
with line breaks, and how `i` is handled separately as ASCII folding).

## Vendored Unicode data

`String.prototype.normalize('NFKC')` uses whatever ICU/Unicode version is
built into the running Node.js binary. Full case folding and the
`White_Space` property are not available as JavaScript built-ins, so they are
vendored from the Unicode Character Database:

- `src/unicode/casefold-data.ts` — generated from
  [`CaseFolding.txt`](https://www.unicode.org/Public/15.0.0/ucd/CaseFolding.txt),
  Unicode **15.0.0**. Only status `C` (common) and `F` (full) mappings are
  included; simple-only (`S`) and Turkic (`T`) mappings are intentionally
  excluded, per the Unicode default case-insensitive matching algorithm.
- `src/unicode/whitespace-data.ts` — generated from the `White_Space` entries
  in [`PropList.txt`](https://www.unicode.org/Public/15.0.0/ucd/PropList.txt),
  Unicode **15.0.0**. `Pattern_White_Space` entries are excluded (a distinct,
  narrower property).

Both files record their source Unicode version as an exported constant
(`CASEFOLD_UNICODE_VERSION`, `WHITE_SPACE_UNICODE_VERSION`); `normalize.ts`
throws at import time if the two ever disagree, so the vendored tables can't
silently drift apart.

### Regenerating

`packages/core/scripts/generate-unicode-data.mjs` is a standalone script (not
run during build/test). To bump the vendored Unicode version:

```sh
cd packages/core/scripts
curl -O https://www.unicode.org/Public/<version>/ucd/CaseFolding.txt
curl -O https://www.unicode.org/Public/<version>/ucd/PropList.txt
node generate-unicode-data.mjs
mv out.casefold-data.ts ../src/unicode/casefold-data.ts
mv out.whitespace-data.ts ../src/unicode/whitespace-data.ts
rm CaseFolding.txt PropList.txt
```

Then update this document's version references and re-run the full test
suite, including the shared conformance corpus (which has explicit
normalization vectors for sharp-s and sigma casefolding, non-ASCII
`White_Space`, and CR/CRLF variants).
