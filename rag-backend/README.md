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
| `OPENAI_API_KEY` | OpenAI API key for embeddings | Required (unless `USE_LOCAL_EMBEDDINGS=true`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for synthesis | Required (when using anthropic provider) |
| `USE_LOCAL_EMBEDDINGS` | Use local sentence-transformers instead of OpenAI | `false` |
| `LLM_QUERY_PROVIDER` | LLM provider for queries: `anthropic` or `dispatch` | `anthropic` |
| `LLM_QUERY_MODEL` | Model name for query synthesis | `claude-sonnet-4-20250514` |
| `LLM_INGEST_PROVIDER` | LLM provider for ingest/proposals: `anthropic` or `dispatch` | `anthropic` |
| `LLM_INGEST_MODEL` | Model name for proposal generation | `claude-sonnet-4-20250514` |
| `DISPATCH_URL` | Smithers dispatch server URL | Required when using `dispatch` provider |
| `DISPATCH_TIMEOUT` | Dispatch job timeout in seconds | `300` |
| `CONTENT_DIR` | Path to content directory | `../content-agn` |
| `MEMORY_DB_PATH` | jig SqliteStore path (file) | `./memory_db/memory.db` |
| `TRACER_DB_PATH` | jig SQLite tracer path | `jig_traces.db` |
| `RAG_HOST` | Server host | `0.0.0.0` |
| `RAG_PORT` | Server port | `4735` |

`CHROMA_DB_DIR` is still honored as a fallback for `MEMORY_DB_PATH` during the rollout window.

## API Endpoints

### Query Mode (async)

```bash
# Submit a query job (returns 202 with job_id)
curl -X POST http://localhost:4735/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What do I know about nullifiers?", "n_results": 5}'

# Poll for results
curl http://localhost:4735/jobs/{job_id}
```

### Search Mode

```bash
# Search without synthesis (synchronous)
curl -X POST http://localhost:4735/search \
  -H "Content-Type: application/json" \
  -d '{"query": "nullifiers", "n_results": 10}'
```

### Ingest Mode (async)

```bash
# Submit an ingest job (returns 202 with job_id)
curl -X POST http://localhost:4735/ingest \
  -H "Content-Type: application/json" \
  -d '{"file_path": "../content-agn/entries/2026-01-20-new-entry.yaml"}'

# Poll for proposals
curl http://localhost:4735/jobs/{job_id}

# Approve a proposal (synchronous)
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

The vector store supports multiple embedding backends:

| Mode | When Used | Model |
|------|-----------|-------|
| OpenAI | `OPENAI_API_KEY` is valid | `text-embedding-3-small` |
| Local | No valid OpenAI key | `all-MiniLM-L6-v2` (sentence-transformers) |
| Mock | Testing only | Deterministic 384-dim vectors |

The Docker image pre-downloads the sentence-transformers model to avoid cold-start delays.

## Testing

Tests use `embedders.mock_embedder()` for deterministic behavior without network calls:

```bash
# Run tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=. --cov-report=term-missing
```

`mock_embedder()` returns consistent 384-dimensional vectors seeded by a sha256 of the input,
allowing reliable testing without downloading models or making API calls. `select_embedder()`
also routes to it when `USE_MOCK_EMBEDDINGS=true` is set in the environment.

Note: the vector store persists on disk across restarts and is only seeded on first boot
(when `count()` returns 0). If you change YAML content after the store has been created,
call `POST /reindex` or delete the DB file to rebuild it from source.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│  Web UI         │────▶│  API Server     │────▶│  Vector Store       │
│  (packages/web) │     │  (FastAPI)      │     │  (jig SqliteStore + │
└─────────────────┘     └────────┬────────┘     │   DenseRetriever)   │
                                 │              └─────────────────────┘
                        ┌────────┴────────┐
                        ▼                 ▼
               ┌─────────────────┐ ┌─────────────────┐
               │  LLM Synthesis  │ │  YAML Writer    │
               │  (jig pipeline) │ │  (ruamel.yaml)  │
               └─────────────────┘ └─────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `api.py` | FastAPI endpoints |
| `loader.py` | YAML parsing and document loading |
| `vectorstore.py` | Similarity search + chunking atop jig's `SqliteStore` + `DenseRetriever` |
| `embedders.py` | Embedder selection (mock / local sentence-transformers / OpenAI) |
| `pipelines.py` | jig `PipelineConfig` + `Step` definitions for query + proposal |
| `synthesizer.py` | Prompt building for query synthesis |
| `proposer.py` | Candidate-summary ranking + proposal prompt builder |
| `jobs.py` | In-memory async job store for long-running tasks |
| `writer.py` | YAML write-back with formatting preservation |
