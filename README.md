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
algerknown/
├── packages/
│   ├── core/     # Shared library (file ops, validation, indexing)
│   ├── cli/      # Command-line interface
│   └── web/      # Express API + React frontend
```

The app repo (this repository) is **public**. Your actual knowledge base content lives in a separate **private** repository.

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
```

### Web Interface

```bash
cd packages/web
npm run dev
```

Opens:
- Frontend: http://localhost:5173
- API: http://localhost:3001

The web interface provides:
- Dashboard with stats
- Entry list with type filtering
- Entry detail view with links
- Full-text search
- Graph visualization

### API

All API requests require the `x-zkb-path` header pointing to your knowledge base:

```bash
curl -H "x-zkb-path: /path/to/your/kb" http://localhost:3001/entries
```

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

Your knowledge base content (entries, summaries, schemas) should live in a separate private repository:

```bash
# Create private repo
mkdir my-kb && cd my-kb
git init
agn init

# Add to .gitignore in the content repo
# (nothing — you want to version your knowledge)

# Push to private remote
git remote add origin git@github.com:your-username/my-kb-private.git
git push -u origin main
```

Point algerknown to your content:
```bash
agn --path /path/to/my-kb list
# Or use the x-zkb-path header for API requests
```

## Development

```bash
# Run tests
npm test

# Development mode
npm run dev:cli   # CLI with watch
npm run dev:web   # Web with hot reload
```

## License

MIT
