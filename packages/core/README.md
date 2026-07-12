# @algerknown/core

Core library for managing Algerknown knowledge bases: reading, writing, validating, and searching entries.

## Summary Dossier Contract

A `Summary` entry may include an optional `dossier` field — a canonical, versioned, operator-reviewed project dossier. Dossiers give downstream Scout code a single authoritative source of approved facts, safe phrasings, resources, prohibitions, and known gaps.

### Shape

```yaml
dossier:
  project_key: my-project         # kebab-case; matches the Scout project key
  last_reviewed: '2026-07-01'     # ISO YYYY-MM-DD; must not be in the future
  reviewer:
    id: alice                     # stable reviewer identifier
    display_name: Alice Operator
  evidence:
    - id: evidence-commit-abc123          # prefix: evidence-
      kind: git-blob
      locator: owner/repo @ sha:path/to/file
      immutable_ref: <40-char git SHA or sha256:... digest or DOI or arXiv vN or Wayback snapshot URL>
  facts:
    - id: fact-ships-today                # prefix: fact-
      claim: The project is deployed to production.
      status: shipped                     # shipped | experimental | planned | deprecated
      safe_phrasings:
        - The project is deployed to production.
      evidence_ids:
        - evidence-commit-abc123
  resources:
    - id: res-homepage                    # prefix: res-
      label: Project Homepage
      canonical_url: https://example.com/project   # absolute http/https, no fragment
      purpose: Primary documentation.
      evidence_ids:
        - evidence-commit-abc123
  prohibitions:
    - id: proh-no-claims                  # prefix: proh-
      exact_phrase: guaranteed uptime     # exactly one of: exact_phrase | normalized_phrase | regex
      forbidden_phrasings:
        - guaranteed uptime
      evidence_ids:
        - evidence-commit-abc123
  known_gaps:
    - id: gap-pricing                     # prefix: gap-
      question: What is the final pricing model?
      related_fact_ids:
        - fact-ships-today
```

### Matcher variants for prohibitions

Each prohibition must have **exactly one** matcher:

| Field | Behaviour |
|-------|-----------|
| `exact_phrase` | Literal string match |
| `normalized_phrase` | Case-folded, whitespace-normalised match |
| `regex` | Regular expression; only flags `i`, `m`, `s` are permitted |

### Immutable reference requirements

`evidence.immutable_ref` must pin the cited material so it cannot silently change after approval. Accepted forms:

- **40-char hex git SHA** (commit or blob)
- **`sha256:<hex>`** content digest
- **DOI** starting with `10.`
- **Versioned arXiv id** (e.g. `2303.12345v2`)
- **Wayback Machine snapshot URL** (`https://web.archive.org/web/<14-digit timestamp>/...`)

Branch names, bare HTTP URLs, and unversioned local paths are rejected.

### Semantic validation

`validate()` runs a two-pass check: JSON Schema first, then a semantic pass that reports:

- Globally duplicate IDs across evidence, facts, resources, prohibitions, and known gaps
- Duplicate safe or forbidden phrasings after case-folding and whitespace normalisation
- Broken `evidence_ids`, `resource_ids`, `related_fact_ids`, and `related_resource_ids` references
- Unsupported regex flags or regex compilation failures
- Duplicate canonical URLs after URL normalisation
- `last_reviewed` dates in the future
- Evidence records with non-immutable references

### Backward compatibility

`dossier` is fully optional. All existing `Summary` entries without a dossier continue to validate without change.
