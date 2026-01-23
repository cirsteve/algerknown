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

The server will be available at http://localhost:8000.

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
uvicorn api:app --reload --port 8000
```

</details>

## Configuration

Environment variables (set in root `.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | Required |
| `ANTHROPIC_API_KEY` | Anthropic API key for synthesis | Required |
| `CONTENT_DIR` | Path to content directory | `../content-agn` |
| `CHROMA_DB_DIR` | Path for ChromaDB persistence | `./chroma_db` |
| `RAG_HOST` | Server host | `0.0.0.0` |
| `RAG_PORT` | Server port | `8000` |

## API Endpoints

### Query Mode

```bash
# Query with synthesis
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What do I know about nullifiers?", "n_results": 5}'
```

### Search Mode

```bash
# Search without synthesis
curl -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "nullifiers", "n_results": 10}'
```

### Ingest Mode

```bash
# Ingest new entry and get proposals
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"file_path": "../content-agn/entries/2026-01-20-new-entry.yaml"}'

# Approve a proposal
curl -X POST http://localhost:8000/approve \
  -H "Content-Type: application/json" \
  -d '{"proposal": {"target_summary_id": "...", "source_entry_id": "...", ...}}'
```

### Utility

```bash
# Health check
curl http://localhost:8000/health

# List all entries
curl http://localhost:8000/entries

# Get specific entry
curl http://localhost:8000/entries/{entry_id}

# List summaries
curl http://localhost:8000/summaries

# Re-index all content
curl -X POST http://localhost:8000/reindex
```

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Testing

```bash
# Run tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=. --cov-report=term-missing
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Web UI         │────▶│  API Server     │────▶│  Vector Store   │
│  (packages/web) │     │  (FastAPI)      │     │  (ChromaDB)     │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────┴────────┐
                        ▼                 ▼
               ┌─────────────────┐ ┌─────────────────┐
               │  LLM Synthesis  │ │  YAML Writer    │
               │  (Claude API)   │ │  (ruamel.yaml)  │
               └─────────────────┘ └─────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `api.py` | FastAPI endpoints |
| `loader.py` | YAML parsing and document loading |
| `vectorstore.py` | ChromaDB operations |
| `synthesizer.py` | Claude synthesis (query mode) |
| `proposer.py` | Update proposal generation (ingest mode) |
| `writer.py` | YAML write-back with formatting preservation |
