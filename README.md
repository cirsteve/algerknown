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
│   │       ├── primer.schema.json
│   │       └── index.schema.json
│   ├── cli/                     # Command-line interface
│   └── web/                     # Express API + React frontend
├── rag-backend/                 # Python RAG backend (FastAPI + ChromaDB)
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
├── summaries/                   # Topic summaries (tracked)
└── primers/                     # Primers distilling external source docs (tracked)
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

# Add a primer distilling an external source document
# The --source path is resolved against your current directory, canonicalized,
# and must fall within an allowed ALGERKNOWN_CONTENT_ROOTS directory (see below)
agn add primer --source ./docs/some-report.md

# List all entries
agn list

# List only primers
agn list --type primer

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
- **Ask page** - Natural language queries with AI-synthesized answers
- **Ingest page** - Add entries and auto-propose updates to related summaries

## RAG Backend

The RAG (Retrieval-Augmented Generation) backend provides AI-powered features:

- **Query Mode**: Ask questions in natural language, get synthesized answers with citations
- **Search Mode**: Direct vector search without LLM synthesis
- **Ingest Mode**: When adding new entries, automatically identify related summaries and propose updates


### Setup

```bash
# From project root, copy and configure environment
cp .env.example .env
# Edit .env with your OPENAI_API_KEY and ANTHROPIC_API_KEY

# Start with Docker (recommended)
cd rag-backend
docker-compose up --build
```

The RAG backend runs on http://localhost:4735. The web UI will automatically connect to it.

<details>
<summary>Alternative: Local Python setup (for development)</summary>

```bash
cd rag-backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python api.py
```

</details>

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/query` | POST | Query knowledge base, get synthesized answer |
| `/search` | POST | Vector search without LLM synthesis |
| `/index` | POST | Index entry (make searchable) without proposals/last_ingested update |
| `/ingest` | POST | Ingest new entry, get update proposals (updates last_ingested) |
| `/approve` | POST | Apply approved proposal to YAML |
| `/reindex` | POST | Re-index all content |
| `/health` | GET | Health check and status |

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
├── entries/            # Journal entries (point-in-time records)
└── primers/            # Primers distilling external source documents
```

`agn init` is safe to re-run against an existing knowledge base: if `index.yaml`
already exists it leaves your content and index untouched and only refreshes
`.algerknown/schemas/` (and restores `primers/` if it's missing, e.g. after
cloning an older content repo checkout). Run it again any time the app's
schemas change.

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

### Primer

A primer points Algerknown at an external Markdown document for reading in the
web viewer. `source.path` is always a canonical absolute
path — the CLI resolves and canonicalizes a relative `--source` value against
your current directory before it's written, and validation rejects anything
that isn't already absolute.

```yaml
id: "semaphore-whitepaper"
type: "primer"
topic: "Semaphore V4 Whitepaper"
status: "active"
source:
  path: "/data/docs/semaphore-v4-whitepaper.md"
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

## Primer Source Roots

Primers point at an external source document rather than copying it into the
knowledge base, so every write and read of `source.path` is checked against
an allowlist of directories: `ALGERKNOWN_CONTENT_ROOTS`. This variable must
be set — there's no fallback to the KB root or the process's working
directory — and holds one or more absolute directories, colon-separated:

```bash
export ALGERKNOWN_CONTENT_ROOTS=/home/you/docs:/home/you/papers
```

A primer's `source.path` (whether typed at the `--source` flag or supplied
via `--raw`/`--json`) is only accepted if it resolves (after following
symlinks) inside one of these roots and points at a real file. Paths outside
every configured root, or pointing at a file that doesn't exist, are
rejected before anything is written — no partial primer record is created.

**Container deployments:** mount each content root **read-only** into the
container at the *same path* it has on the host, and point
`ALGERKNOWN_CONTENT_ROOTS` at that in-container path:

```bash
docker run \
  -v /home/you/docs:/home/you/docs:ro \
  -e ALGERKNOWN_CONTENT_ROOTS=/home/you/docs \
  -e ALGERKNOWN_KB_ROOT=/data/content-agn \
  -v /home/you/content-agn:/data/content-agn \
  algerknown-web
```

Matching host and container paths matters because `source.path` is persisted
in the primer's YAML as a plain absolute path — if the CLI writes it from the
host (e.g. `/home/you/docs/report.md`) but the web/RAG containers mount that
directory somewhere else, the stored path won't resolve inside the
container. Keep the mount path identical everywhere a given content root is
used, whether that's your host shell, the web container, or the RAG backend.

## Development

For working on the algerknown app itself:

```bash
# Run tests
npm test

# Development mode with hot reload
npm run dev:web   # Web with hot reload (needs ZKB_PATH env var)

# Build all packages
npm run build

# Run RAG backend tests
cd rag-backend
pytest tests/ -v
```

To develop with a content directory:
```bash
ZKB_PATH=/path/to/content-agn npm run dev:web
```

## License

MIT
