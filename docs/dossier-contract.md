# Dossier contract: schema, semantics, and versioning

The `dossier` block on a summary is a versioned, tamper-evident data contract
consumed by Scout. This document describes what enforces what, how the
contract is published, and how to run the shared conformance corpus that
proves producer and consumer agree.

## Schema vs. semantic responsibilities

Two layers validate a dossier, in order. `validate()` runs the JSON Schema
pass first; only if it passes does the semantic pass run.

**JSON Schema (`packages/core/schemas/summary.schema.json`, Draft 2020-12)**
enforces everything that is purely structural and local to one field or one
record:

- Required fields, types, and `additionalProperties: false` on every dossier
  record shape (`dossier`, `dossierReviewer`, `dossierEvidence`, `dossierFact`,
  `dossierResource`, `dossierProhibition`, `dossierKnownGap`).
- `dossierFact.status` enum (`supported`, `qualified`, `uncertain`, `shipped`,
  `experimental`, `planned`, `deprecated`).
- `dossierProhibition` matcher exclusivity and flags coupling, expressed as
  `oneOf` branches: exactly one of `exact_phrase` / `normalized_phrase` /
  `regex` may be present, and `flags` is only valid alongside `regex`.
- `dossierProhibition.flags` — a closed enum of the 16 valid `i`/`m`/`s`
  permutations (see [regex-grammar.md](./regex-grammar.md)).
- `dossierEvidence.immutable_ref` — an anchored (`^...$`) reference-grammar
  pattern (git SHA, `sha256:` digest, DOI, arXiv id, or Wayback URL).

**Semantic validation (`packages/core/src/validator.ts`)** enforces
cross-record rules that JSON Schema cannot express, plus one thing that isn't
structural but also isn't cross-record:

- Globally unique dossier ids across every record type.
- `last_reviewed` must not be in the future.
- `evidence_ids` / `resource_ids` / `related_fact_ids` / `related_resource_ids`
  must reference an id that actually exists in the same dossier.
- `canonical_url` uniqueness after URL canonicalization.
- `safe_phrasings` / `forbidden_phrasings` uniqueness after canonical
  normalization (see [unicode-normalization.md](./unicode-normalization.md)).
- Portable-regex grammar validation of `dossierProhibition.regex` — this is
  not expressible as a JSON Schema pattern (it's a recursive grammar, not a
  regular language), so it is parsed with the allowlist parser in
  `src/regex/portable-regex.ts` and rejected with a structured error if it
  uses a non-portable construct.

## Contract versioning and publication

Algerknown's `packages/core/schemas/*.json` are the only hand-edited schema
source. content-agn publishes the current v1 data contract as
`schemas/index.v1.schema.json` and `schemas/summary.v1.schema.json` —
byte-for-byte copies of the Algerknown package schemas, with versioned `$id`
values. These v1 files are immutable except for backward-compatible
corrections agreed by both the Algerknown and Scout maintainers; an
incompatible change creates v2 files instead of editing v1 in place.

content-agn also tracks the *deployed* copies at `.algerknown/schemas/*` (an
otherwise-ignored operational directory, narrowly unignored for these three
files). `.algerknown/schemas/summary.schema.json` and
`.algerknown/schemas/index.schema.json` must be byte-identical to the
corresponding `schemas/*.v1.schema.json` files, and
`.algerknown/schemas/entry.schema.json` must be byte-identical to
Algerknown's `packages/core/schemas/entry.schema.json`. CI in both
repositories asserts this parity before merge — see each repo's
`.github/workflows/ci.yml`.

Scout (the downstream consumer) reads the contract from a pinned content-agn
revision, so the versioned tracked files — not the network, not a package
release — are the tamper-evident source of truth for a given revision.

## Regex grammar and normalization

See [regex-grammar.md](./regex-grammar.md) for the portable regex grammar and
flag semantics, and [unicode-normalization.md](./unicode-normalization.md) for
the canonical phrase-normalization pipeline and vendored Unicode data.

## Running the shared conformance corpus

The corpus lives in `content-agn/conformance/v1/` (manifest + fixtures +
normalization/prohibition vectors) and is the single source of test cases
shared by the Algerknown (producer) and Scout (consumer) implementations.

From `packages/core/`:

```sh
CONFORMANCE_CORPUS_DIR=../../content-agn/conformance/v1 npx vitest run tests/conformance.test.ts
```

In CI, Algerknown checks out the exact content-agn revision recorded in
`packages/core/tests/conformance-corpus-revision.json` (see
`.github/workflows/ci.yml`) rather than relying on a local checkout path, so
the corpus a given Algerknown commit is tested against is pinned and
reproducible. content-agn's own CI runs the same runner against its working
tree, validating all current `index.yaml` and `summaries/*.yaml` data before
merge.
