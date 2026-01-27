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
- A conceptual connection or insight was noticed (use `spark` tag)

### 2. Summary (Topic Summary)
Use for: **Aggregated knowledge over time** — synthesizing learnings across multiple sessions.

Create or update a summary when:
- Multiple related entries exist on a topic
- Key decisions were made that should be documented
- Insights emerged that apply broadly
- A topic has matured enough to consolidate

---

## Tag Conventions

Tags serve two purposes: categorization and semantic meaning. Some tags have special significance:

### Semantic Tags

| Tag | Use when... |
|-----|-------------|
| `spark` | A conceptual connection or insight—not a work session, just an idea worth capturing. Lightweight entries that may seed future work. |
| `friction` | Something was harder than it should be. Captures pain points that may indicate build opportunities. |
| `decision` | A significant choice was made. Useful for filtering entries that shaped direction. |
| `conceptual` | Theoretical or architectural thinking rather than implementation. |
| `debugging` | Time spent diagnosing issues. |
| `learning` | Focused study or research session. |

### Domain Tags

Use lowercase, hyphenated tags for technologies, projects, and domains:
- `zk`, `semaphore`, `noir`, `circom`
- `veranon`, `algerknown`, `rank-one-labs`
- `rust`, `typescript`, `solidity`

### Example: Spark Entry

A `spark` is just an entry with minimal fields—no `time_hours`, `approach`, or `commits` needed:

```yaml
id: "2026-01-27-mac-vs-zk-trust-models"
type: "entry"
date: "2026-01-27"
topic: "Algebraic MACs and ZK circuits as trust model approaches"
status: "active"
tags:
  - spark
  - zk
  - anonymous-credentials

context: |
  Reading Cloudflare's anonymous credentials work alongside Noir circuit implementations.

outcome:
  surprised:
    - "Both solve 'prove membership without revealing identity' but MACs need issuer online, ZK doesn't"
    - "ZK approach trades computation for trust assumptions"

links:
  - id: "cloudflare-anon-credentials-analysis"
    relationship: "informs"
```

---

## Schemas

> **Source of truth:** These schemas are copied from `packages/core/schemas/` in the algerknown repo.
> Canonical URLs:
> - https://raw.githubusercontent.com/cirsteve/algerknown/refs/heads/main/packages/core/schemas/entry.schema.json
> - https://raw.githubusercontent.com/cirsteve/algerknown/refs/heads/main/packages/core/schemas/summary.schema.json
>
> If you update the schemas, update this doc.

### Entry Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/entry.schema.json",
  "title": "Algerknown Entry",
  "description": "A journal entry capturing work done at a specific point in time",
  "type": "object",
  "required": ["id", "type", "date", "topic", "status"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique identifier, typically YYYY-MM-DD-slug",
      "pattern": "^[a-z0-9-]+$"
    },
    "type": {
      "type": "string",
      "const": "entry"
    },
    "date": {
      "type": "string",
      "format": "date",
      "description": "Date of the entry (YYYY-MM-DD)"
    },
    "topic": {
      "type": "string",
      "description": "Human-readable topic name"
    },
    "status": {
      "type": "string",
      "enum": ["active", "archived", "reference", "blocked", "planned"]
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "time_hours": {
      "type": "number",
      "minimum": 0,
      "description": "Approximate hours spent"
    },
    "context": {
      "type": "string",
      "description": "What problem was being solved, what was already known"
    },
    "approach": {
      "type": "string",
      "description": "What was tried, methodology used"
    },
    "outcome": {
      "type": "object",
      "properties": {
        "worked": {
          "type": "array",
          "items": { "type": "string" },
          "description": "What succeeded"
        },
        "failed": {
          "type": "array",
          "items": { "type": "string" },
          "description": "What didn't work"
        },
        "surprised": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Unexpected findings"
        }
      }
    },
    "commits": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Related git commit hashes"
    },
    "resources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["url"],
        "properties": {
          "url": { "type": "string", "format": "uri" },
          "title": { "type": "string" },
          "notes": { "type": "string" }
        }
      }
    },
    "links": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "relationship"],
        "properties": {
          "id": { "type": "string", "description": "ID of the linked entry" },
          "relationship": {
            "type": "string",
            "enum": [
              "evolved_into", "evolved_from",
              "informs", "informed_by",
              "part_of", "contains",
              "blocked_by", "blocks",
              "supersedes", "superseded_by",
              "references", "referenced_by",
              "depends_on", "dependency_of",
              "enables", "enabled_by"
            ]
          },
          "notes": { "type": "string" }
        }
      }
    },
    "last_ingested": {
      "type": "string",
      "format": "date",
      "description": "Date this entry was last ingested into the RAG system (auto-populated)"
    }
  }
}
```

### Summary Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/summary.schema.json",
  "title": "Algerknown Summary",
  "description": "A topic summary aggregating learnings, decisions, and artifacts",
  "type": "object",
  "required": ["id", "type", "topic", "status", "summary"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique identifier for this summary",
      "pattern": "^[a-z0-9-]+$"
    },
    "type": {
      "type": "string",
      "const": "summary"
    },
    "topic": {
      "type": "string",
      "description": "Human-readable topic name"
    },
    "status": {
      "type": "string",
      "enum": ["active", "archived", "reference", "blocked", "planned"]
    },
    "summary": {
      "type": "string",
      "description": "Brief description of the topic"
    },
    "date_range": {
      "type": "object",
      "required": ["start"],
      "properties": {
        "start": {
          "type": "string",
          "pattern": "^\\d{4}(-\\d{2})?(-\\d{2})?$",
          "description": "Start date (YYYY, YYYY-MM, or YYYY-MM-DD)"
        },
        "end": {
          "type": "string",
          "pattern": "^\\d{4}(-\\d{2})?(-\\d{2})?$",
          "description": "End date (YYYY, YYYY-MM, or YYYY-MM-DD)"
        }
      }
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "learnings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["insight"],
        "properties": {
          "insight": { "type": "string", "description": "The key learning or insight" },
          "context": { "type": "string", "description": "How this was discovered" },
          "relevance": {
            "type": "array",
            "items": { "type": "string" },
            "description": "IDs of related entries"
          }
        }
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["decision"],
        "properties": {
          "decision": { "type": "string", "description": "What was decided" },
          "rationale": { "type": "string", "description": "Why this decision was made" },
          "trade_offs": { "type": "string", "description": "What was sacrificed or risked" },
          "date": { "type": "string", "format": "date" },
          "superseded_by": { "type": "string", "description": "ID of decision that replaced this one" }
        }
      }
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path"],
        "properties": {
          "repo": { "type": "string", "description": "Repository URL or name" },
          "path": { "type": "string", "description": "Path within the repo" },
          "notes": { "type": "string" },
          "commit": { "type": "string", "description": "Specific commit hash" }
        }
      }
    },
    "open_questions": {
      "type": "array",
      "items": { "type": "string" }
    },
    "resources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["url"],
        "properties": {
          "url": { "type": "string", "format": "uri" },
          "title": { "type": "string" },
          "notes": { "type": "string" }
        }
      }
    },
    "links": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "relationship"],
        "properties": {
          "id": { "type": "string", "description": "ID of the linked entry" },
          "relationship": {
            "type": "string",
            "enum": [
              "evolved_into", "evolved_from",
              "informs", "informed_by",
              "part_of", "contains",
              "blocked_by", "blocks",
              "supersedes", "superseded_by",
              "references", "referenced_by",
              "depends_on", "dependency_of",
              "enables", "enabled_by"
            ]
          },
          "notes": { "type": "string" }
        }
      }
    },
    "last_ingested": {
      "type": "string",
      "format": "date",
      "description": "Date this entry was last ingested into the RAG system (auto-populated)"
    }
  }
}
```

---

## Field Constraints

> **No extra top-level fields allowed.** Both schemas have `"additionalProperties": false`, which means validation will reject any fields not explicitly defined in the schema.
> 
> If you have general observations, notes, or context that doesn't fit a specific field:
> - **Entries:** Put it in `context`
> - **Summaries:** Put it in `summary`
>
> Do not invent fields like `notes`, `observations`, `details`, `thoughts`, etc.

---

## Relationship Types

Use these exact values for the `relationship` field. Relationships are bidirectional pairs—use whichever direction makes sense from the current entry's perspective:

| Relationship | Inverse | Use when... |
|-------------|---------|-------------|
| `evolved_into` | `evolved_from` | This work led to or became something else |
| `informs` | `informed_by` | This provides knowledge useful for another entry |
| `part_of` | `contains` | This is a component of a larger topic |
| `blocked_by` | `blocks` | Progress depends on another entry being resolved |
| `supersedes` | `superseded_by` | This replaced a previous approach or decision |
| `references` | `referenced_by` | General reference to related content |
| `depends_on` | `dependency_of` | This requires understanding/using another concept |
| `enables` | `enabled_by` | This makes something else possible |

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
- **Conceptual insight or connection noticed?** → Create an Entry with `spark` tag
- **Accumulated knowledge on a topic?** → Create or update a Summary
- **Both?** → Create an Entry AND update the related Summary

### Step 2: Extract Key Information

For **Entries**, look for:
- What date did this happen?
- What problem was being solved? (→ `context`)
- What was tried? (→ `approach`)
- What worked? What failed? What was surprising? (→ `outcome`)
- How long did it take? (→ `time_hours`)
- Any commits or code references? (→ `commits`)
- Any links/docs referenced? (→ `resources`)
- Was something frustrating or harder than expected? (→ add `friction` tag)

For **Summaries**, look for:
- What topic does this cover?
- What are the key insights? (→ `learnings`)
- What decisions were made and why? (→ `decisions`)
- What code/artifacts were produced? (→ `artifacts`, note: `path` is required)
- What's still unknown? (→ `open_questions`)

### Step 3: Generate Valid YAML

- **Use ONLY fields defined in the schemas above—no extra top-level fields**
- IDs must be lowercase alphanumeric with hyphens only: `^[a-z0-9-]+$`
- Entry IDs should be date-prefixed: `2026-01-14-topic-slug`
- Use `|` for multi-line strings
- Ensure all required fields are present
- Use exact enum values (don't invent new statuses or relationships)
- For `date_range`, `start` is required if you include the field
- For `date_range.start/end` format is `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`
- For `artifacts`, `path` is required; `repo` is optional

### Step 4: Suggest Links

Look for connections to potentially existing entries:
- Is this part of a larger project? → `part_of`
- Does this build on previous work? → `evolved_from` (on this entry) or `evolved_into` (on the previous)
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

- [ ] **No extra top-level fields**—schemas have `additionalProperties: false`, validation will fail for undefined fields
- [ ] `id` matches `^[a-z0-9-]+$`
- [ ] `type` is exactly `"entry"` or `"summary"`
- [ ] `status` is one of: `active`, `archived`, `reference`, `blocked`, `planned`
- [ ] `relationship` values are from the 16-value enum (see Relationship Types)
- [ ] `date` format is `YYYY-MM-DD`
- [ ] `date_range.start` is present if `date_range` is used
- [ ] `date_range.start/end` format is `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`
- [ ] `artifacts[].path` is present for each artifact
- [ ] URLs in `resources` are valid URIs
- [ ] All required fields are present per schema
- [ ] General observations go in `context` (entries) or `summary` (summaries), not in invented fields