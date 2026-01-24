"""
Algerknown RAG - API Server

FastAPI endpoints for query and ingest functionality.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from contextlib import asynccontextmanager
import os
import logging
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from root .env first, then local .env
load_dotenv("../.env")  # Root .env
load_dotenv()  # Local .env (overrides)

from loader import load_content, flatten_document
from vectorstore import VectorStore
from synthesizer import synthesize_answer
from proposer import generate_all_proposals
from writer import apply_update, preview_update, validate_proposal

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Configuration
CONTENT_DIR = os.path.abspath(os.getenv("CONTENT_DIR", "../content-agn"))
CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "./chroma_db")

# Global state
vector_store: Optional[VectorStore] = None
entries_cache: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - initialize on startup."""
    global vector_store, entries_cache
    
    logger.info(f"Initializing RAG backend...")
    logger.info(f"Content directory: {CONTENT_DIR}")
    logger.info(f"ChromaDB directory: {CHROMA_DB_DIR}")
    
    # Initialize vector store
    vector_store = VectorStore(CHROMA_DB_DIR)
    
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


app = FastAPI(
    title="Algerknown RAG API",
    description="Query and ingest API for the Algerknown knowledge base",
    version="0.1.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:2393",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:2393",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
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


class QueryResponse(BaseModel):
    answer: str
    sources: list[str]
    model: Optional[str] = None
    error: Optional[str] = None


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest):
    """
    Query the knowledge base and get a synthesized answer.
    
    Retrieves relevant documents and uses Claude to synthesize
    an answer with citations.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    # Retrieve similar documents
    retrieved = vector_store.query(request.query, request.n_results)
    
    if not retrieved:
        return QueryResponse(
            answer="No relevant documents found for your query.",
            sources=[]
        )
    
    # Synthesize answer
    result = synthesize_answer(request.query, retrieved)
    
    return QueryResponse(
        answer=result.get("answer", ""),
        sources=result.get("sources", []),
        model=result.get("model"),
        error=result.get("error")
    )


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

class IngestRequest(BaseModel):
    file_path: str = Field(..., description="Path to new entry YAML file")


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


class IngestResponse(BaseModel):
    entry_id: str
    proposals: list[ProposalData]


@app.post("/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest):
    """
    Ingest a new entry and generate update proposals.
    
    Loads the entry, identifies related summaries, and generates
    structured proposals for updating them.
    """
    if not vector_store:
        raise HTTPException(status_code=503, detail="Vector store not initialized")
    
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    
    # Security: ensure file is within content directory
    abs_path = os.path.abspath(request.file_path)
    
    if not abs_path.startswith(CONTENT_DIR):
        raise HTTPException(
            status_code=400,
            detail=f"File must be within content directory: {CONTENT_DIR}"
        )
    
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail="Entry file not found")
    
    # Load the entry
    try:
        with open(request.file_path) as f:
            raw_entry = yaml_parser.load(f)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse YAML: {e}")
    
    if not raw_entry or "id" not in raw_entry:
        raise HTTPException(status_code=400, detail="Invalid entry: missing 'id' field")
    
    # Build document
    entry = {
        "id": raw_entry["id"],
        "content": flatten_document(raw_entry),
        "metadata": {
            "type": raw_entry.get("type", "entry"),
            "topic": raw_entry.get("topic", ""),
            "tags": ",".join(raw_entry.get("tags", [])),
            "status": raw_entry.get("status", ""),
            "file_path": request.file_path,
        },
        "raw": raw_entry
    }
    
    # Index the new entry
    vector_store.index_documents([entry])
    entries_cache[entry["id"]] = entry
    logger.info(f"Indexed new entry: {entry['id']}")
    
    # Generate proposals
    proposals = generate_all_proposals(entry, vector_store)
    
    return IngestResponse(
        entry_id=entry["id"],
        proposals=[ProposalData(**p) for p in proposals]
    )


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
    
    # Re-index the updated summary
    documents = load_content(CONTENT_DIR)
    updated = [d for d in documents if d["id"] == request.proposal.target_summary_id]
    if updated and vector_store:
        vector_store.index_documents(updated)
        entries_cache[updated[0]["id"]] = updated[0]
    
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
        entries.append({
            "id": doc_id,
            "type": metadata.get("type", "entry"),
            "topic": metadata.get("topic", ""),
            "status": metadata.get("status", ""),
            "path": metadata.get("file_path", ""),
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


# ============ Main ============

if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("RAG_HOST", os.getenv("HOST", "0.0.0.0"))
    port = int(os.getenv("RAG_PORT", os.getenv("PORT", "8000")))
    
    uvicorn.run("api:app", host=host, port=port, reload=True)
