# Copilot Instructions for Algerknown

This file provides context and guidelines for GitHub Copilot when working on the Algerknown codebase.

## Project Overview

Algerknown is a CLI + Web application for managing a personal knowledge base with YAML files. The system uses plain YAML files as the source of truth (no database), with JSON Schema validation, full-text search, and AI-powered RAG (Retrieval-Augmented Generation) features.

## Architecture

```
algerknown/
├── packages/
│   ├── core/          # Shared library (TypeScript) - file ops, validation, indexing
│   ├── cli/           # Command-line interface (TypeScript, Commander.js)
│   └── web/           # Express API + React frontend (TypeScript, React, Vite)
├── rag-backend/       # Python RAG backend (FastAPI, ChromaDB, OpenAI/Anthropic)
└── LLM_INSTRUCTIONS.md # Instructions for AI assistants creating YAML entries
```

### Key Technologies

**Frontend/Backend (TypeScript):**
- TypeScript 5.3+
- Node.js workspace (npm workspaces)
- React 18 with React Router
- Express.js for API server
- Vite for frontend bundling
- Vitest for testing
- TailwindCSS for styling

**Python Backend:**
- FastAPI for API server
- ChromaDB for vector storage
- OpenAI/Anthropic for LLM integration
- pytest for testing
- ruamel.yaml for YAML parsing

## Development Workflow

### Building the Project

```bash
# Build all packages
npm run build

# Build specific workspace
npm run build --workspace=@algerknown/core
npm run build --workspace=@algerknown/cli
npm run build --workspace=@algerknown/web
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests for a specific package
npm test --workspace=@algerknown/core

# Python backend tests
cd rag-backend
pytest tests/ -v
```

### Development Mode

```bash
# CLI development with hot reload
npm run dev:cli

# Web development with hot reload (requires ZKB_PATH env var)
ZKB_PATH=/path/to/content npm run dev:web

# Core library development with watch mode
cd packages/core
npm run dev
```

### Linting

```bash
# Lint all packages
npm run lint

# Lint specific workspace
npm run lint --workspace=@algerknown/core
```

## Code Style and Conventions

### TypeScript

- Use TypeScript strict mode
- Prefer ES6+ features (arrow functions, destructuring, async/await)
- Use explicit types for function parameters and return values
- Avoid `any` types - use `unknown` or proper types
- Use functional programming patterns where appropriate
- Organize imports: external libraries first, then internal modules

### File Organization

- Keep related functionality in the same directory
- Use barrel exports (`index.ts`) for public APIs
- Place types/interfaces in separate files or at the top of modules
- Test files should be colocated with source files in a `tests/` subdirectory

### React Components

- Use functional components with hooks
- Prefer composition over prop drilling
- Use SWR for data fetching and caching
- Keep components small and focused
- Use TailwindCSS utility classes for styling

### Python

- Follow PEP 8 style guidelines
- Use type hints for function signatures
- Use async/await for I/O operations
- Keep functions focused and small
- Write docstrings for public APIs

## Key Concepts

### Entry Types

The system supports two types of YAML entries:

1. **Entry** (`type: "entry"`): Point-in-time journal entries capturing specific work sessions
2. **Summary** (`type: "summary"`): Aggregated topic summaries synthesizing knowledge over time

See `LLM_INSTRUCTIONS.md` for detailed schema documentation.

### Schema Validation

All YAML files are validated against JSON Schema definitions in `packages/core/schemas/`:
- `entry.schema.json` - Validates journal entries
- `summary.schema.json` - Validates topic summaries
- `index.schema.json` - Validates the index file

The core library uses AJV for validation.

### Indexing

The system maintains an `index.yaml` file that maps entry IDs to file paths. This enables fast lookups without scanning the filesystem.

### Relationships

Entries can link to each other with typed relationships:
- `evolved_into` - This led to or became something else
- `informs` - Provides knowledge relevant to another entry
- `part_of` - Component of a larger topic
- `blocked_by` - Progress depends on another entry
- `supersedes` - Replaced a previous approach
- `references` - General reference to related content
- `depends_on` - Requires another concept or tool
- `enables` - Makes something else possible

## Testing Guidelines

### TypeScript Tests

- Use Vitest for unit tests
- Test files use `.test.ts` extension
- Place tests in `tests/` subdirectory within each package
- Mock file system operations when testing file I/O
- Test both success and error cases

### Python Tests

- Use pytest for all tests
- Test files use `test_*.py` naming convention
- Place tests in `rag-backend/tests/` directory
- Use `pytest-asyncio` for async test cases
- Mock external API calls (OpenAI, Anthropic)

## Working with Workspaces

The project uses npm workspaces. Key points:

- Packages reference each other using `"@algerknown/package-name": "*"`
- Always run commands from the project root when working across packages
- Use `--workspace` flag to target specific packages
- Run `npm install` from root to install all dependencies

## Common Patterns

### Reading/Writing YAML

Use the core library's file operations:

```typescript
import { readYaml, writeYaml, validateEntry } from '@algerknown/core';

const entry = await readYaml('path/to/entry.yaml');
const isValid = validateEntry(entry);
await writeYaml('path/to/entry.yaml', entry);
```

### Error Handling

- Use custom error classes for domain-specific errors
- Always provide meaningful error messages
- Log errors with context information
- Handle file system errors gracefully (file not found, permissions, etc.)

### API Endpoints (Express)

- Use RESTful conventions
- Return consistent JSON responses
- Include proper HTTP status codes
- Support optional `x-zkb-path` header for custom knowledge base paths
- Use middleware for common operations (CORS, error handling)

## Documentation

- Update `README.md` when changing user-facing features
- Update `LLM_INSTRUCTIONS.md` when changing YAML schemas
- Add JSDoc comments for public APIs
- Keep code comments focused on "why" not "what"

## Security Considerations

- Never commit secrets (API keys, credentials) to the repository
- Use `.env` files for configuration (see `.env.example`)
- Validate all user inputs
- Sanitize file paths to prevent directory traversal
- Use parameterized queries/safe YAML parsing to prevent injection

## RAG Backend

The Python backend provides AI-powered features:

- **Query mode**: Natural language Q&A with citations
- **Ingest mode**: Auto-propose summary updates when adding entries
- Uses vector embeddings for semantic search
- Supports OpenAI and Anthropic LLMs

When working on RAG features:
- Keep prompts in separate modules for maintainability
- Test with both LLM providers
- Consider rate limits and costs
- Cache embeddings to avoid recomputation

## Private Content Repositories

Users keep their actual knowledge base content in separate private repositories (typically named with `-agn` suffix). The app repository should never contain user content - only the application code and schemas.

Key points:
- The `.gitignore` excludes `*-agn/` directories
- Content repos use schemas copied from the app
- Web UI respects the `x-zkb-path` header for multi-repo support

## Troubleshooting

### Build Issues

- Ensure all workspaces are built: `npm run build`
- Check TypeScript version compatibility
- Clear `dist/` directories if seeing stale build artifacts

### Test Issues

- Ensure test database/fixtures are properly set up
- Check for port conflicts (web: 2393, RAG: 8000)
- Verify environment variables are set for integration tests

### Python Environment

- Use Python 3.9+
- Create virtual environment: `python -m venv venv`
- Install dependencies: `pip install -r requirements.txt`
- For Docker: `docker-compose up --build`
