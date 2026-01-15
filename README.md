# Algerknown

A CLI + Web application for managing a personal knowledge base with YAML files. No database — files are the source of truth.

## Overview

Algerknown helps you build a structured, searchable knowledge base using plain YAML files. It's designed for developers and researchers who want to:

- **Capture learnings** as they happen with journal entries
- **Aggregate knowledge** into topic summaries over time
- **Link concepts** with typed relationships
- **Search and explore** your knowledge graph
- **Validate data** with JSON Schema

## Architecture

```
algerknown/                      # Public app repo
├── packages/
│   ├── core/
│   │   ├── src/                 # Shared library (file ops, validation, indexing)
│   │   └── schemas/             # JSON Schema definitions (source of truth)
│   │       ├── summary.schema.json
│   │       ├── entry.schema.json
│   │       └── index.schema.json
│   ├── cli/                     # Command-line interface
│   └── web/                     # Express API + React frontend
├── README.md
├── LLM_INSTRUCTIONS.md          # Instructions for AI assistants
└── LICENSE
```

Your knowledge base content lives in a separate **private** repository (use `-agn` suffix):

```
content-agn/                     # Private content repo
├── index.yaml                   # Entry index (tracked)
├── .algerknown/
│   └── schemas/                 # Copied from app during init (gitignored)
├── entries/                     # Journal entries (tracked)
└── summaries/                   # Topic summaries (tracked)
```

## Installation

```bash
# Clone and install
git clone https://github.com/your-username/algerknown.git
cd algerknown
npm install
npm run build

# Install CLI globally
npm link --workspace=@algerknown/cli
```

## Usage

### CLI

```bash
# Initialize a new knowledge base in current directory
agn init

# Add entries interactively
agn add

# List all entries
agn list

# Show entry details
agn show <id>

# Create relationships between entries
agn link <from-id> <to-id> <relationship>

# Search your knowledge base
agn search "query"

# Validate all entries against schemas
agn validate

# Scan and add missing files to index.yaml
agn index
agn index --dry-run  # Preview without modifying
```

### Web Interface

From inside your knowledge base directory:

```bash
cd your-content-agn
agn web
```

Opens at http://localhost:2393 with:
- Dashboard with stats
- Entry list with type filtering
- Entry detail view with links
- Full-text search
- Graph visualization

### API

The API server runs on port 2393. If you need to point to a different knowledge base, use the `x-zkb-path` header:

```bash
curl -H "x-zkb-path: /path/to/other/kb" http://localhost:2393/api/entries
```

By default, the server uses the knowledge base directory it was started from (via `agn web`).

## Knowledge Base Structure

When you run `agn init`, it creates:

```
my-knowledge-base/
├── .algerknown/
│   ├── index.yaml      # Maps IDs to file paths
│   └── schemas/        # JSON Schema validation files
├── summaries/          # Topic summaries (aggregated knowledge)
└── entries/            # Journal entries (point-in-time records)
```

## Entry Types

### Summary

A topic summary aggregating learnings, decisions, and artifacts over time.

```yaml
id: "semaphore-protocol"
type: "summary"
topic: "Semaphore Protocol Implementation"
status: "active"
summary: "ZK-based anonymous signaling protocol..."
learnings:
  - insight: "Poseidon hash is 60x more efficient in-circuit than SHA-256"
    context: "Benchmarking hash functions for ZK proofs"
decisions:
  - decision: "Use Semaphore V4 for anonymous surveys"
    rationale: "Better audited, active development"
links:
  - id: "zk-hash-functions"
    relationship: "depends_on"
```

### Entry

A journal entry capturing work done at a specific point in time.

```yaml
id: "2026-01-14-fix-merkle-depth"
type: "entry"
date: "2026-01-14"
topic: "Fixed Merkle Tree Depth Issue"
status: "archived"
context: "Proofs were failing for trees with >1000 members"
approach: "Increased depth from 16 to 20"
outcome:
  worked:
    - "Supports up to 1M members now"
  surprised:
    - "Proving time only increased by 200ms"
```

## Relationship Types

Link entries together with typed relationships:

| Relationship | Description |
|-------------|-------------|
| `evolved_into` | This led to or became something else |
| `informs` | Provides knowledge relevant to another entry |
| `part_of` | Component of a larger topic |
| `blocked_by` | Progress depends on another entry |
| `supersedes` | Replaced a previous approach |
| `references` | General reference to related content |
| `depends_on` | Requires another concept or tool |
| `enables` | Makes something else possible |

## Private Content Repository

Your knowledge base content (entries, summaries) lives in a separate private repository. Use the `-agn` suffix naming convention:

```bash
# Create a private repo named "content-agn" (or "personal-agn", "work-agn", etc.)
# Then clone it into the algerknown directory:
cd algerknown
git clone git@github.com:your-username/content-agn.git
cd content-agn

# Initialize or update schemas
agn init

# Start the web UI
agn web
```

The `.gitignore` in the algerknown app ignores any `*-agn/` directories, keeping your private content separate.

Your content repo's `.gitignore` should include:
```
.algerknown/
```

This ignores the schemas (they're copied fresh on `agn init`).

## Development

For working on the algerknown app itself:

```bash
# Run tests
npm test

# Development mode with hot reload
npm run dev:web   # Web with hot reload (needs ZKB_PATH env var)

# Build all packages
npm run build
```

To develop with a content directory:
```bash
ZKB_PATH=/path/to/content-agn npm run dev:web
```

## License

MIT
