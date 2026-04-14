"""
Algerknown RAG - API Server

FastAPI endpoints for query and ingest functionality.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from contextlib import asynccontextmanager
from datetime import date
import asyncio
import os
import logging
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from root .env first, then local .env
load_dotenv("../.env")  # Root .env
load_dotenv()  # Local .env (overrides)

from jig import run_pipeline, map_pipeline
from jig.core.types import LLMClient
from jig.llm import AnthropicClient
from jig.tracing import SQLiteTracer

from loader import load_content, flatten_document
from vectorstore import VectorStore
from proposer import identify_related_summaries
from pipelines import build_query_pipeline, build_proposal_pipeline
from writer import apply_update, preview_update, validate_proposal
from diff_engine import Changelog, VersionCache, diff_and_log
from jobs import JobStore, JobStatus

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Configuration
# ALGERKNOWN_KB_ROOT is the primary env var, CONTENT_DIR supported for backwards compatibility
CONTENT_DIR = os.path.abspath(
    os.getenv("ALGERKNOWN_KB_ROOT") or os.getenv("CONTENT_DIR") or "../content-agn"
)
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")

# Global state
vector_store: Optional[VectorStore] = None
entries_cache: dict = {}
changelog: Optional[Changelog] = None
version_cache: Optional[VersionCache] = None
_stats_cache: Optional[dict] = None
_stats_cache_file_info: Optional[tuple[float, int]] = None  # (mtime, size)


def create_llm_client(provider: str, model: str) -> LLMClient:
    """Create an LLM client based on provider and model.

    Supports:
      - "anthropic": Cloud Anthropic API
      - "dispatch": Local models via smithers dispatch
    """
    provider = provider.strip().lower()
    if provider == "anthropic":
        return AnthropicClient(model=model)
    elif provider == "dispatch":
        dispatch_url = (os.getenv("DISPATCH_URL") or "").strip()
        if not dispatch_url:
            raise ValueError(
                "DISPATCH_URL must be set when LLM provider is 'dispatch'. "
                "Example: http://localhost:8900"
            )
        try:
            timeout = int(os.getenv("DISPATCH_TIMEOUT", "300"))
        except ValueError:
            logger.warning("Invalid DISPATCH_TIMEOUT, defaulting to 300s")
            timeout = 300

        from jig.llm import DispatchClient
        return DispatchClient(
            model=model,
            dispatch_url=dispatch_url,
            requester="algerknown",
            timeout_seconds=timeout,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - initialize on startup."""
    global vector_store, entries_cache, changelog, version_cache

    logger.info(f"Initializing RAG backend...")
    logger.info(f"Content directory: {CONTENT_DIR}")
    logger.info(f"ChromaDB directory: {CHROMA_DB_DIR}")

    # Initialize vector store
    vector_store = VectorStore(CHROMA_DB_DIR)

    # Initialize LLM clients (configurable per operation), tracer, and job store
    query_provider = os.getenv("LLM_QUERY_PROVIDER", "anthropic")
    query_model = os.getenv("LLM_QUERY_MODEL", "claude-sonnet-4-20250514")
    ingest_provider = os.getenv("LLM_INGEST_PROVIDER", "anthropic")
    ingest_model = os.getenv("LLM_INGEST_MODEL", "claude-sonnet-4-20250514")

    app.state.query_llm = create_llm_client(query_provider, query_model)
    app.state.ingest_llm = create_llm_client(ingest_provider, ingest_model)
    logger.info(f"Query LLM: {query_provider}/{query_model}")
    logger.info(f"Ingest LLM: {ingest_provider}/{ingest_model}")

    tracer_db = os.getenv("TRACER_DB_PATH", "jig_traces.db")
    app.state.tracer = SQLiteTracer(db_path=tracer_db)
    app.state.job_store = JobStore()

    # Initialize changelog and version cache
    changelog = Changelog(Path(CONTENT_DIR) / "changelog.jsonl")
    version_cache = VersionCache(Path(CONTENT_DIR) / ".version_cache")

    # Load and index content
    content_path = Path(CONTENT_DIR)
    if content_path.exists():
        documents = load_content(CONTENT_DIR)
        vector_store.index_documents(documents)
        entries_cache = {d["id"]: d for d in documents}
        logger.info(f"Indexed {len(documents)} documents")
    else:
        logger.warning(f"Content directory not found: {CONTENT_DIR}")

    yield

    logger.info("Shutting down RAG backend...")
    await app.state.tracer.close()


app = FastAPI(
    title="Algerknown RAG API",
    description="Query and ingest API for the Algerknown knowledge base",
    version="0.1.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Health Check ============

@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "documents_indexed": vector_store.count() if vector_store else 0,
        "content_dir": CONTENT_DIR,
    }


# ============ Query Mode ============

class QueryRequest(BaseModel):
    query: str = Field(..., description="Natural language query")
    n_results: int = Field(default=5, ge=1, le=20, description="Number of results to retrieve")


class JobSubmitResponse(BaseModel):
    job_id: str
    status: str


@app.post("/query", response_model=JobSubmitResponse, status_code=202)
async def query(request: QueryRequest):
    """
    Submit a query job for async processing.

    Returns a job ID immediately. Poll GET /jobs/{job_id} for results.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")

    job = app.state.job_store.create("query")
    task = asyncio.create_task(
        run_query_job(job.id, request.query, request.n_results)
    )
    app.state.job_store.update(job.id, _task=task)

    return {"job_id": job.id, "status": job.status.value}


async def run_query_job(job_id: str, query_text: str, n_results: int):
    """Background task: run query pipeline and store result."""
    store = app.state.job_store
    store.update(job_id, status=JobStatus.RUNNING, progress="Retrieving documents...")

    try:
        pipeline = build_query_pipeline(app.state.tracer)
        pipeline_result = await run_pipeline(
            pipeline,
            input={"query": query_text, "n_results": n_results},
            context={"vector_store": vector_store, "llm": app.state.query_llm},
        )
        await app.state.tracer.flush()
        result = pipeline_result.output

        store.update(
            job_id,
            status=JobStatus.COMPLETE,
            progress="Complete",
            progress_detail=None,
            trace_id=pipeline_result.trace_id,
            result={
                "answer": result.get("answer", ""),
                "sources": result.get("sources", []),
                "model": result.get("model"),
                "error": result.get("error"),
            },
        )
    except Exception as e:
        logger.error(f"Query job {job_id} failed: {e}")
        try:
            await app.state.tracer.flush()
        except Exception as flush_err:
            logger.debug(f"Tracer flush failed after query job error: {flush_err}")
        store.update(job_id, status=JobStatus.FAILED, progress="Failed",
                     progress_detail=None, result=None, error=str(e))


# ============ Job Status ============

@app.get("/jobs")
async def list_jobs(status: Optional[str] = None, limit: int = 50):
    """List all jobs, optionally filtered by status."""
    limit = min(max(limit, 1), 200)
    store = app.state.job_store
    status_filter = None
    if status:
        try:
            status_filter = JobStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}") from None
    all_jobs = store.list_all(status=status_filter, limit=10000)
    total = len(all_jobs)
    jobs = all_jobs[:limit]
    return {"jobs": [store.to_dict(j) for j in jobs], "total": total, "returned": len(jobs)}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get the status and result of an async job."""
    job = app.state.job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return app.state.job_store.to_dict(job)


# ============ Traces ============

def _span_to_dict(span) -> dict:
    """Serialize a jig Span to a JSON-friendly dict."""
    import json as _json
    def _safe_dumps(obj):
        if obj is None:
            return None
        if isinstance(obj, str):
            return obj
        try:
            return _json.dumps(obj, default=str)
        except (TypeError, ValueError):
            return repr(obj)

    return {
        "id": span.id,
        "trace_id": span.trace_id,
        "parent_id": span.parent_id,
        "kind": span.kind.value if hasattr(span.kind, "value") else str(span.kind),
        "name": span.name,
        "input": _safe_dumps(span.input),
        "output": _safe_dumps(span.output),
        "started_at": span.started_at.isoformat() if span.started_at else None,
        "ended_at": span.ended_at.isoformat() if span.ended_at else None,
        "duration_ms": span.duration_ms,
        "error": span.error,
        "usage": {
            "input_tokens": span.usage.input_tokens,
            "output_tokens": span.usage.output_tokens,
            "cost": span.usage.cost,
        } if span.usage else None,
    }


@app.get("/traces")
async def list_traces(limit: int = 50, before: Optional[str] = None):
    """
    List root pipeline traces with aggregated step/error counts.

    Uses direct DB queries since SQLiteTracer.list_traces() filters on
    AGENT_RUN, but algerknown pipelines use PIPELINE_RUN as root spans.
    """
    limit = min(max(limit, 1), 200)
    tracer = app.state.tracer
    db = await tracer._get_db()

    # Query root spans (no parent) — these are the top-level pipeline/map executions
    query = """
        SELECT s.trace_id, s.name, s.started_at, s.duration_ms, s.error,
               COUNT(c.id) AS step_count,
               SUM(CASE WHEN c.error IS NOT NULL THEN 1 ELSE 0 END) AS error_count
        FROM spans s
        LEFT JOIN spans c ON c.trace_id = s.trace_id AND c.id != s.id
        WHERE s.parent_id IS NULL
    """
    params: list = []
    if before:
        query += " AND s.started_at < ?"
        params.append(before)
    query += " GROUP BY s.trace_id ORDER BY s.started_at DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    traces = []
    for row in rows:
        trace_id, name, started_at, duration_ms, error, step_count, error_count = row
        traces.append({
            "trace_id": trace_id,
            "name": name,
            "started_at": started_at,
            "duration_ms": duration_ms,
            "error": error,
            "step_count": step_count,
            "error_count": error_count,
        })

    # Determine next_cursor for pagination
    next_cursor = traces[-1]["started_at"] if traces else None

    return {"traces": traces, "next_cursor": next_cursor}


@app.get("/traces/{trace_id}")
async def get_trace(trace_id: str):
    """Get all spans for a specific trace."""
    tracer = app.state.tracer
    spans = await tracer.get_trace(trace_id)
    if not spans:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {"spans": [_span_to_dict(s) for s in spans]}


# ============ Search Mode (without synthesis) ============

class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query")
    n_results: int = Field(default=10, ge=1, le=50)
    type_filter: Optional[str] = Field(default=None, description="Filter by type: 'entry' or 'summary'")


class SearchResult(BaseModel):
    id: str
    topic: str
    type: str
    distance: float
    snippet: str


class SearchResponse(BaseModel):
    results: list[SearchResult]


@app.post("/search", response_model=SearchResponse)
def search(request: SearchRequest):
    """
    Search the knowledge base without LLM synthesis.
    
    Returns raw search results for browsing/exploration.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    where = None
    if request.type_filter:
        where = {"type": request.type_filter}
    
    retrieved = vector_store.query(request.query, request.n_results, where)
    
    results = []
    for doc in retrieved:
        metadata = doc.get("metadata", {})
        content = doc.get("content", "")
        # Create snippet from first 200 chars
        snippet = content[:200] + "..." if len(content) > 200 else content
        
        results.append(SearchResult(
            id=doc["id"],
            topic=metadata.get("topic", ""),
            type=metadata.get("type", "entry"),
            distance=doc.get("distance", 0),
            snippet=snippet
        ))
    
    return SearchResponse(results=results)


# ============ Ingest Mode ============

def load_entry_document(file_path: str, content_dir: str) -> tuple[str, dict, dict]:
    """
    Load and validate an entry document from a file path.
    
    This helper function consolidates the common logic used by both /ingest and /index endpoints:
    - Path resolution (absolute/relative)
    - Security validation (commonpath check)
    - YAML file loading
    - Document structure building
    
    Args:
        file_path: Path to the entry file (absolute or relative to content_dir)
        content_dir: Root content directory path
    
    Returns:
        Tuple of (abs_path, raw_entry, document)
        - abs_path: Absolute path to the entry file
        - raw_entry: Raw YAML data as loaded from file
        - document: Structured document dict with id, content, metadata, and raw fields
    
    Raises:
        HTTPException: On validation errors, missing files, or YAML parse failures
    """
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    yaml_parser.preserve_quotes = True
    
    # Security: ensure file is within content directory
    # Use commonpath to prevent prefix bypass (e.g., content-agn vs content-agn-backup)
    # If path is relative, resolve it against content_dir
    if os.path.isabs(file_path):
        abs_path = os.path.abspath(file_path)
    else:
        abs_path = os.path.abspath(os.path.join(content_dir, file_path))
    
    try:
        common = os.path.commonpath([content_dir, abs_path])
        if common != content_dir:
            raise HTTPException(
                status_code=400,
                detail=f"File must be within content directory: {content_dir}"
            )
    except ValueError:
        # commonpath raises ValueError if paths are on different drives (Windows)
        raise HTTPException(
            status_code=400,
            detail=f"File must be within content directory: {content_dir}"
        )
    
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Entry file not found")
    
    # Load the entry
    try:
        with open(abs_path) as f:
            raw_entry = yaml_parser.load(f)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse YAML: {e}")
    
    if not raw_entry or "id" not in raw_entry:
        raise HTTPException(status_code=400, detail="Invalid entry: missing 'id' field")
    
    # Normalize tags
    tags_list = raw_entry.get("tags")
    if tags_list is None:
        tags_list = []
    elif not isinstance(tags_list, list):
         # Handle case where tags might be a single string or other type
        if isinstance(tags_list, str):
            tags_list = [t.strip() for t in tags_list.split(",")]
        else:
            tags_list = [str(tags_list)]
    
    # Ensure all elements are strings
    tags_str = ",".join(str(t) for t in tags_list if t)

    # Build document
    document = {
        "id": raw_entry["id"],
        "content": flatten_document(raw_entry),
        "metadata": {
            "type": raw_entry.get("type", "entry"),
            "topic": raw_entry.get("topic", ""),
            "tags": tags_str,
            "status": raw_entry.get("status", ""),
            "file_path": abs_path,
        },
        "raw": raw_entry
    }
    
    return abs_path, raw_entry, document


class FilePathRequest(BaseModel):
    file_path: str = Field(..., description="Path to entry YAML file")


class IngestRequest(FilePathRequest):
    max_proposals: Optional[int] = Field(default=None, ge=1, le=20, description="Maximum proposals to generate (default: MAX_PROPOSALS env var or 5)")


class ProposalData(BaseModel):
    target_summary_id: str
    source_entry_id: str
    new_learnings: Optional[list[dict]] = None
    new_decisions: Optional[list[dict]] = None
    new_open_questions: Optional[list[str]] = None
    new_links: Optional[list[dict]] = None
    rationale: Optional[str] = None
    match_score: Optional[float] = None
    match_reason: Optional[str] = None


@app.post("/ingest", response_model=JobSubmitResponse, status_code=202)
async def ingest(request: IngestRequest):
    """
    Submit an ingest job for async processing.

    Validates the entry synchronously, then runs indexing and proposal
    generation in the background. Poll GET /jobs/{job_id} for results.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")

    # Validate entry synchronously so errors return immediately
    load_entry_document(request.file_path, CONTENT_DIR)

    job = app.state.job_store.create("ingest")
    task = asyncio.create_task(
        run_ingest_job(job.id, request.file_path, request.max_proposals)
    )
    app.state.job_store.update(job.id, _task=task)

    return {"job_id": job.id, "status": job.status.value}


async def run_ingest_job(job_id: str, file_path: str, max_proposals: int | None):
    """Background task: ingest entry, index, and generate proposals."""
    store = app.state.job_store
    store.update(job_id, status=JobStatus.RUNNING, progress="Loading entry...")

    try:
        # Load and validate entry
        abs_path, raw_entry, entry = load_entry_document(file_path, CONTENT_DIR)

        # Update last_ingested date
        store.update(job_id, progress="Updating entry metadata...")
        from ruamel.yaml import YAML
        yaml_parser = YAML()
        yaml_parser.preserve_quotes = True
        yaml_parser.indent(mapping=2, sequence=4, offset=2)

        last_ingested = date.today().isoformat()
        raw_entry["last_ingested"] = last_ingested
        try:
            with open(abs_path, 'w') as f:
                yaml_parser.dump(raw_entry, f)
            logger.info(f"Updated last_ingested for entry: {entry['id']}")
            entry["raw"] = raw_entry
            entry["metadata"]["last_ingested"] = last_ingested
        except Exception as e:
            raw_entry.pop("last_ingested", None)
            logger.warning(f"Failed to update last_ingested: {e}")

        # Index the entry
        store.update(job_id, progress="Indexing entry...")
        vector_store.index_documents([entry])
        entries_cache[entry["id"]] = entry
        logger.info(f"Indexed new entry: {entry['id']}")

        # Log changes
        if changelog and version_cache:
            try:
                changes = diff_and_log(abs_path, raw_entry, changelog, version_cache)
                logger.info(f"Logged {len(changes)} changes for {entry['id']}")
            except Exception as e:
                logger.warning(f"Failed to log changes: {e}")

        # Find related summaries
        store.update(job_id, progress="Finding related summaries...")
        related = identify_related_summaries(entry, vector_store, max_results=max_proposals)

        if not related:
            store.update(
                job_id,
                status=JobStatus.COMPLETE,
                progress="Complete",
                result={"entry_id": entry["id"], "proposals": []},
            )
            return

        # Generate proposals (parallel via map_pipeline)
        n = len(related)
        store.update(
            job_id,
            progress=f"Generating proposals for {n} {'summary' if n == 1 else 'summaries'}...",
        )

        proposal_pipeline = build_proposal_pipeline(app.state.tracer)
        map_result = await map_pipeline(
            proposal_pipeline,
            items=[{"entry": entry, "summary": s} for s in related],
            context={"llm": app.state.ingest_llm},
        )
        await app.state.tracer.flush()
        proposals = [
            r.output for r in map_result.results
            if not r.output.get("no_updates") and not r.output.get("error")
        ]

        store.update(
            job_id,
            status=JobStatus.COMPLETE,
            progress="Complete",
            progress_detail=None,
            trace_id=map_result.trace_id,
            result={
                "entry_id": entry["id"],
                "proposals": proposals,
            },
        )

    except Exception as e:
        logger.error(f"Ingest job {job_id} failed: {e}")
        try:
            await app.state.tracer.flush()
        except Exception as flush_err:
            logger.debug(f"Tracer flush failed after ingest job error: {flush_err}")
        store.update(job_id, status=JobStatus.FAILED, progress="Failed",
                     progress_detail=None, result=None, error=str(e))


class IndexRequest(FilePathRequest):
    file_path: str = Field(..., description="Path to the entry YAML file to index")


@app.post("/index")
def index_document(request: IndexRequest):
    """
    Index an entry without generating proposals or updating last_ingested.
    
    Used for initial creation of entries where we want them searchable
    but don't want to trigger the full ingestion workflow yet.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    # Load and validate the entry using shared helper
    _abs_path, _raw_entry, entry = load_entry_document(request.file_path, CONTENT_DIR)
    
    # Index the entry
    vector_store.index_documents([entry])
    entries_cache[entry["id"]] = entry
    logger.info(f"Indexed entry (no proposals/last_ingested update): {entry['id']}")
    
    return {"status": "indexed", "id": entry["id"]}


# ============ Approve Updates ============

class ApproveRequest(BaseModel):
    proposal: ProposalData


class ApproveResponse(BaseModel):
    success: bool
    file: Optional[str] = None
    changes: Optional[list[str]] = None
    error: Optional[str] = None


@app.post("/approve", response_model=ApproveResponse)
def approve(request: ApproveRequest):
    """
    Apply an approved proposal to update a summary.
    
    Writes the proposed changes to the YAML file.
    """
    proposal_dict = request.proposal.model_dump()
    
    # Validate
    is_valid, error = validate_proposal(proposal_dict)
    if not is_valid:
        return ApproveResponse(success=False, error=error)
    
    # Apply update
    result = apply_update(proposal_dict, CONTENT_DIR)
    
    if not result.get("success"):
        return ApproveResponse(success=False, error=result.get("error"))
    
    # Re-index the updated summary and log changes
    documents = load_content(CONTENT_DIR)
    updated = [d for d in documents if d["id"] == request.proposal.target_summary_id]
    if updated and vector_store:
        vector_store.index_documents(updated)
        entries_cache[updated[0]["id"]] = updated[0]
        
        # Log the diff for this summary update
        if changelog and version_cache:
            file_path = result.get("file", "")
            if file_path:
                diff_and_log(file_path, updated[0]["raw"], changelog, version_cache)
    
    return ApproveResponse(
        success=True,
        file=result.get("file"),
        changes=result.get("changes", [])
    )


class PreviewRequest(BaseModel):
    proposal: ProposalData


@app.post("/preview")
def preview(request: PreviewRequest):
    """Preview what changes a proposal would make."""
    proposal_dict = request.proposal.model_dump()
    return preview_update(proposal_dict, CONTENT_DIR)


# ============ Utility Endpoints ============

@app.post("/reindex")
def reindex():
    """Re-index all content from the content directory."""
    global entries_cache
    
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    documents = load_content(CONTENT_DIR)
    vector_store.index_documents(documents)
    entries_cache = {d["id"]: d for d in documents}
    
    return {"indexed": len(documents)}


@app.get("/entries")
def list_entries():
    """List all indexed entry IDs with metadata."""
    entries = []
    for doc_id, doc in entries_cache.items():
        metadata = doc.get("metadata", {})
        raw = doc.get("raw", {})
        entries.append({
            "id": doc_id,
            "type": metadata.get("type", "entry"),
            "topic": metadata.get("topic", ""),
            "status": metadata.get("status", ""),
            "path": metadata.get("file_path", ""),
            "last_ingested": raw.get("last_ingested") or metadata.get("last_ingested"),
        })
    
    # Sort by type (summaries first) then by id
    entries.sort(key=lambda x: (0 if x["type"] == "summary" else 1, x["id"]))
    
    return {"entries": entries, "total": len(entries)}


@app.get("/entries/{entry_id}")
def get_entry(entry_id: str):
    """Get a specific entry by ID."""
    if entry_id not in entries_cache:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    doc = entries_cache[entry_id]
    return {
        "id": doc["id"],
        "content": doc["content"],
        "metadata": doc["metadata"],
        "raw": doc.get("raw", {})
    }


@app.get("/summaries")
def list_summaries():
    """List all summary documents."""
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    summaries = vector_store.get_summaries()
    return {
        "summaries": [
            {
                "id": s["id"],
                "topic": s.get("metadata", {}).get("topic", ""),
            }
            for s in summaries
        ],
        "total": len(summaries)
    }


# ============ Changelog Endpoints ============

@app.get("/changelog")
def get_changelog(
    limit: int = 50,
    source: Optional[str] = None,
    path: Optional[str] = None,
    change_type: Optional[str] = None
):
    """
    Get recent changes from the changelog.
    
    Supports filtering by source file, node path, and change type.
    Multiple filters can be combined (AND logic).
    """
    if not changelog:
        raise HTTPException(status_code=503, detail="Changelog not initialized")
    
    # Validate change_type if provided
    if change_type and change_type not in ("added", "modified", "removed"):
        raise HTTPException(status_code=400, detail="Invalid change_type. Must be: added, modified, removed")
    
    # TODO: For large changelogs, consider implementing pagination at the Changelog
    # class level with indexed queries, or migrate to a database backend.
    # Start with all changes and apply filters cumulatively
    changes = changelog.read_all()
    
    if source:
        changes = [c for c in changes if c.get("source") == source]
    
    if path:
        changes = [c for c in changes if c.get("path", "").startswith(path)]
    
    if change_type:
        changes = [c for c in changes if c.get("type") == change_type]
    
    # Sort by timestamp descending (most recent first)
    changes = sorted(changes, key=lambda c: c.get("timestamp", ""), reverse=True)
    total_matching = len(changes)
    
    return {
        "changes": changes[:limit],
        "total": total_matching
    }


@app.get("/changelog/sources")
def get_changelog_sources():
    """Get list of unique source files in the changelog."""
    if not changelog:
        raise HTTPException(status_code=503, detail="Changelog not initialized")
    
    all_changes = changelog.read_all()
    sources = sorted(set(c.get("source", "") for c in all_changes if c.get("source")))
    
    return {"sources": sources}


@app.get("/changelog/stats")
def get_changelog_stats():
    """Get changelog statistics."""
    global _stats_cache, _stats_cache_file_info
    
    if not changelog:
        raise HTTPException(status_code=503, detail="Changelog not initialized")
    
    # Use file mtime and size for efficient cache validation (no file reads needed)
    try:
        stat = changelog.path.stat()
        current_file_info = (stat.st_mtime, stat.st_size)
    except FileNotFoundError:
        current_file_info = (0.0, 0)
    
    # Return cached stats if file hasn't changed
    if _stats_cache and _stats_cache_file_info == current_file_info:
        return _stats_cache
    
    # Cache miss - read and compute stats
    all_changes = changelog.read_all()
    
    # Count by type
    by_type = {"added": 0, "modified": 0, "removed": 0}
    for c in all_changes:
        change_type = c.get("type", "")
        if change_type in by_type:
            by_type[change_type] += 1
    
    # Get date range
    timestamps = [c.get("timestamp", "") for c in all_changes if c.get("timestamp")]
    
    _stats_cache = {
        "total_changes": len(all_changes),
        "by_type": by_type,
        "first_change": min(timestamps) if timestamps else None,
        "last_change": max(timestamps) if timestamps else None,
    }
    _stats_cache_file_info = current_file_info
    
    return _stats_cache


@app.get("/entries/{entry_id}/history")
def get_entry_history(entry_id: str, limit: int = 50):
    """Get change history for a specific entry."""
    if not changelog:
        raise HTTPException(status_code=503, detail="Changelog not initialized")
    
    # Find the entry's source file from cache (preferred - exact match)
    if entry_id in entries_cache:
        source_file = entries_cache[entry_id].get("metadata", {}).get("file_path", "")
        if source_file:
            changes = changelog.read_by_source(source_file)
            return {"entry_id": entry_id, "changes": changes[:limit], "total": len(changes)}
    
    # Fallback: search by exact entry id match in source filename
    # Only matches files named exactly "{entry_id}.yaml" to avoid false positives
    # (e.g., "snark" won't match "zkSNARKs.yaml")
    all_changes = changelog.read_all()
    changes = [
        c for c in all_changes 
        if c.get("source", "").endswith(f"/{entry_id}.yaml") 
        or c.get("source", "") == f"{entry_id}.yaml"
    ]
    changes.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
    
    return {"entry_id": entry_id, "changes": changes[:limit], "total": len(changes)}


# ============ Main ============

if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("RAG_HOST", os.getenv("HOST", "0.0.0.0"))
    port = int(os.getenv("RAG_PORT", os.getenv("PORT", "4735")))
    
    uvicorn.run("api:app", host=host, port=port, reload=True)
