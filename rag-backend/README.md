# Algerknown RAG Backend

RAG (Retrieval-Augmented Generation) backend for the Algerknown knowledge base.

## Features

- **Query Mode**: Natural language queries with synthesized answers and citations
- **Ingest Mode**: Add new entries and get proposed updates for related summaries
- **Search Mode**: Direct vector search without LLM synthesis

## Quick Start

```bash
# From the project root, copy and configure environment
cp .env.example .env
# Edit .env with your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)

# Run with Docker Compose (recommended)
cd rag-backend
docker-compose up --build
```

The server will be available at http://localhost:4735.

<details>
<summary>Alternative: Local Python setup (for development)</summary>

```bash
cd rag-backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server (uses .env from project root)
python api.py
# Or with auto-reload:
uvicorn api:app --reload --port 4735
```

</details>

## Configuration

Environment variables (set in root `.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | Required (or use `USE_LOCAL_EMBEDDINGS=true`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for proposer / synthesizer | Required |
| `CONTENT_DIR` | Path to content directory | `../content-agn` |
| `MEMORY_DB_PATH` | Path to the jig memory SQLite file | `./memory.db` |
| `FEEDBACK_DB_PATH` | Path to the jig feedback SQLite file | `./feedback.db` |
| `TRACE_DB_PATH` | Path to the jig trace SQLite file | `./traces.db` |
| `PROPOSER_MODEL` | Model for the proposer agent | `claude-sonnet-4-6` |
| `SYNTHESIZER_MODEL` | Model for the synthesizer agent | `claude-sonnet-4-6` |
| `RAG_HOST` | Server host | `0.0.0.0` |
| `RAG_PORT` | Server port | `4735` |

## API Endpoints

### Query Mode

```bash
# Query with synthesis
curl -X POST http://localhost:4735/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What do I know about nullifiers?", "n_results": 5}'
```

### Search Mode

```bash
# Search without synthesis
curl -X POST http://localhost:4735/search \
  -H "Content-Type: application/json" \
  -d '{"query": "nullifiers", "n_results": 10}'
```

### Ingest Mode

```bash
# Ingest new entry and get proposals
curl -X POST http://localhost:4735/ingest \
  -H "Content-Type: application/json" \
  -d '{"file_path": "../content-agn/entries/2026-01-20-new-entry.yaml"}'

# Approve a proposal
curl -X POST http://localhost:4735/approve \
  -H "Content-Type: application/json" \
  -d '{"proposal": {"target_summary_id": "...", "source_entry_id": "...", ...}}'
```

### Utility

```bash
# Health check
curl http://localhost:4735/health

# List all entries
curl http://localhost:4735/entries

# Get specific entry
curl http://localhost:4735/entries/{entry_id}

# List summaries
curl http://localhost:4735/summaries

# Re-index all content
curl -X POST http://localhost:4735/reindex
```

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:4735/docs
- ReDoc: http://localhost:4735/redoc

## Embedding Options

The memory store (jig `SqliteStore`) accepts a custom embedder:

| Mode | When Used | Model |
|------|-----------|-------|
| OpenAI | Valid `OPENAI_API_KEY` and no override | `text-embedding-3-small` |
| Local | `USE_LOCAL_EMBEDDINGS=true` or no OpenAI key | `all-MiniLM-L6-v2` (sentence-transformers) |
| Mock | `USE_MOCK_EMBEDDINGS=true` (tests) | Deterministic 384-dim vectors |

The Docker image pre-downloads the sentence-transformers model to avoid cold-start delays.

## Testing

Tests use `MockEmbeddingFunction` for deterministic behavior without network calls:

```bash
# Run tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=. --cov-report=term-missing
```

The mock embedding function returns consistent 384-dimensional vectors based on input hashing,
allowing reliable testing without downloading models or making API calls.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│  Web UI         │────▶│  API Server     │────▶│  Memory Store       │
│  (packages/web) │     │  (FastAPI)      │     │  (jig SqliteStore   │
└─────────────────┘     └────────┬────────┘     │   + DenseRetriever) │
                                 │              └─────────────────────┘
                        ┌────────┴────────┐
                        ▼                 ▼
               ┌─────────────────┐ ┌─────────────────┐
               │  Synthesizer    │ │  YAML Writer    │
               │  (jig agent)    │ │  (ruamel.yaml)  │
               └─────────────────┘ └─────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `api.py` | FastAPI endpoints |
| `loader.py` | YAML parsing and document loading |
| `memory_store.py` | Thin wrapper over jig's `SqliteStore` + `DenseRetriever` (chunking, reconstruction, embedder selection) |
| `synthesizer.py` | Synthesizer agent (`jig.run_agent` + `SynthesizedAnswer`) |
| `proposer.py` | Proposer agent (`jig.run_agent` + `Proposal`) |
| `writer.py` | YAML write-back with formatting preservation |
