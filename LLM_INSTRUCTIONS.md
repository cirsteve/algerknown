# Algerknown LLM Instructions

You are helping maintain a personal knowledge base using the Algerknown system. Your task is to create structured YAML entries from conversations, research sessions, or work logs.

## Entry Types

There are two types of entries you can create:

### 1. Entry (Journal Entry)
Use for: **Point-in-time work sessions** — debugging, implementation, exploration, learning something new.

Create an entry when:
- A specific problem was worked on
- Code was written or debugged
- A focused learning session occurred
- Something was tried (whether it worked or not)

### 2. Summary (Topic Summary)
Use for: **Aggregated knowledge over time** — synthesizing learnings across multiple sessions.

Create or update a summary when:
- Multiple related entries exist on a topic
- Key decisions were made that should be documented
- Insights emerged that apply broadly
- A topic has matured enough to consolidate

---

## Entry Schema

```yaml
# yaml-language-server: $schema=../.algerknown/schemas/entry.schema.json
id: "YYYY-MM-DD-short-slug"      # Required: lowercase, hyphens only
type: "entry"                     # Required: literal "entry"
date: "YYYY-MM-DD"               # Required: ISO date
topic: "Human-Readable Title"     # Required: what was worked on
status: "active"                  # Required: active|archived|reference|blocked|planned

tags:                             # Optional: for categorization
  - tag-one
  - tag-two

time_hours: 2.5                   # Optional: approximate time spent

context: |                        # Optional: what problem, what was known
  Describe the starting point.
  What problem was being solved?
  What was already understood?

approach: |                       # Optional: what was tried
  Describe the methodology.
  What approaches were attempted?
  What tools or techniques were used?

outcome:                          # Optional: what happened
  worked:                         # Things that succeeded
    - "First successful outcome"
    - "Second successful outcome"
  failed:                         # Things that didn't work
    - "Approach X failed because Y"
  surprised:                      # Unexpected discoveries
    - "Didn't expect Z to happen"

commits:                          # Optional: related git commits
  - "abc123"
  - "def456"

resources:                        # Optional: external references
  - url: "https://example.com/docs"
    title: "Relevant Documentation"
    notes: "Section 3 was most helpful"

links:                            # Optional: relationships to other entries
  - id: "other-entry-id"
    relationship: "part_of"       # See relationship types below
    notes: "Why this link matters"
```

---

## Summary Schema

```yaml
# yaml-language-server: $schema=../.algerknown/schemas/summary.schema.json
id: "topic-slug"                  # Required: lowercase, hyphens only
type: "summary"                   # Required: literal "summary"
topic: "Human-Readable Topic"     # Required: topic name
status: "active"                  # Required: active|archived|reference|blocked|planned
summary: |                        # Required: brief description
  One paragraph overview of this topic.
  What is it? Why does it matter?

date_range:                       # Optional: when work occurred
  start: "YYYY-MM"                # Can be YYYY, YYYY-MM, or YYYY-MM-DD
  end: "YYYY-MM"

tags:
  - relevant-tag

learnings:                        # Key insights discovered
  - insight: "The main thing learned"
    context: "How/when this was discovered"
    relevance:                    # IDs of related entries
      - "related-entry-id"

decisions:                        # Important choices made
  - decision: "What was decided"
    rationale: "Why this choice was made"
    trade_offs: "What was sacrificed"
    date: "YYYY-MM-DD"
    superseded_by: null           # ID if this decision was replaced

artifacts:                        # Code/files produced
  - repo: "github.com/user/repo"
    path: "src/feature/file.ts"
    notes: "Main implementation"
    commit: "abc123"

open_questions:                   # Unresolved questions
  - "What happens when X?"
  - "Should we consider Y?"

resources:
  - url: "https://example.com"
    title: "Resource Title"
    notes: "Why this is useful"

links:
  - id: "other-summary-id"
    relationship: "depends_on"
```

---

## Relationship Types

Use these exact values for the `relationship` field:

| Relationship | Use when... |
|-------------|-------------|
| `evolved_into` | This work led to or became something else |
| `informs` | This provides knowledge useful for another entry |
| `part_of` | This is a component of a larger topic |
| `blocked_by` | Progress depends on another entry being resolved |
| `supersedes` | This replaced a previous approach or decision |
| `references` | General reference to related content |
| `depends_on` | This requires understanding/using another concept |
| `enables` | This makes something else possible |

---

## Status Values

| Status | Meaning |
|--------|---------|
| `active` | Currently relevant, being worked on |
| `archived` | Complete, historical reference |
| `reference` | Evergreen, not time-bound |
| `blocked` | Waiting on external dependency |
| `planned` | Future work, not started |

---

## How to Extract from Conversations

When given a conversation or work session, follow this process:

### Step 1: Identify Entry Type
- **Single session with specific work?** → Create an Entry
- **Accumulated knowledge on a topic?** → Create or update a Summary
- **Both?** → Create an Entry AND update the related Summary

### Step 2: Extract Key Information

For **Entries**, look for:
- What date did this happen?
- What problem was being solved? (→ `context`)
- What was tried? (→ `approach`)
- What worked? What failed? What was surprising? (→ `outcome`)
- How long did it take? (→ `time_hours`)
- Any commits or code references? (→ `commits`, `artifacts`)
- Any links/docs referenced? (→ `resources`)

For **Summaries**, look for:
- What topic does this cover?
- What are the key insights? (→ `learnings`)
- What decisions were made and why? (→ `decisions`)
- What code/artifacts were produced? (→ `artifacts`)
- What's still unknown? (→ `open_questions`)

### Step 3: Generate Valid YAML

- IDs must be lowercase alphanumeric with hyphens only: `^[a-z0-9-]+$`
- Entry IDs should be date-prefixed: `2026-01-14-topic-slug`
- Use `|` for multi-line strings
- Ensure all required fields are present
- Use exact enum values (don't invent new statuses or relationships)

### Step 4: Suggest Links

Look for connections to potentially existing entries:
- Is this part of a larger project? → `part_of`
- Does this build on previous work? → `evolved_into` (from the previous)
- Does this require understanding something else? → `depends_on`

---

## Example Extraction

**Input conversation snippet:**
> "Spent about 3 hours today debugging why Semaphore proofs were failing. Turned out the Merkle tree depth was set to 16 but we had 2000 members. Increased to 20 and it works now. Surprisingly, proving time only went up by 200ms."

**Output Entry:**

```yaml
id: "2026-01-14-semaphore-merkle-depth-fix"
type: "entry"
date: "2026-01-14"
topic: "Semaphore Merkle Tree Depth Fix"
status: "archived"

tags:
  - semaphore
  - debugging
  - merkle-trees

time_hours: 3

context: |
  Semaphore proofs were failing for groups with more than ~1000 members.
  The root cause was unclear initially.

approach: |
  Investigated Semaphore circuit constraints.
  Discovered tree depth of 16 only supports 2^16 = 65,536 leaves but
  the actual limit depends on the proof generation.
  Increased depth from 16 to 20.

outcome:
  worked:
    - "Proofs now succeed for 2000+ member groups"
    - "Depth of 20 supports up to 1M members"
  surprised:
    - "Proving time only increased by ~200ms despite 4x depth increase"

links:
  - id: "semaphore-veranon"
    relationship: "part_of"
    notes: "Part of the Veranon implementation work"
```

---

## Output Format

When asked to create entries, output:
1. The complete YAML (in a code block)
2. The suggested filename: `entries/YYYY-MM-DD-slug.yaml` or `summaries/slug.yaml`
3. Any suggested links to existing entries (if known)
4. Any questions if information is ambiguous

---

## Validation Rules

Ensure your output passes these checks:
- [ ] `id` matches `^[a-z0-9-]+$`
- [ ] `type` is exactly `"entry"` or `"summary"`
- [ ] `status` is one of: `active`, `archived`, `reference`, `blocked`, `planned`
- [ ] `relationship` values are from the allowed list
- [ ] `date` format is `YYYY-MM-DD`
- [ ] `date_range.start/end` format is `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`
- [ ] URLs in `resources` are valid URIs
- [ ] All required fields are present
