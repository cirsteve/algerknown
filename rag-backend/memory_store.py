"""Memory store wrapper — replaces the ChromaDB-backed VectorStore.

Sits on top of jig's ``SqliteStore`` + ``DenseRetriever`` and preserves
algerknown's existing API shape:

- ``index_documents(store, documents)`` chunks long content, stores each
  chunk with ``parent_id`` metadata, and upserts (replaces prior rows
  with the same ``entry_id``)
- ``search(retriever, query, n_results, where)`` returns the same
  ``list[dict]`` shape as the old ``VectorStore.query`` — chunks
  reconstructed into one row per parent, best-scoring chunk wins
- ``get_summaries(store)`` scans metadata, reconstructs parents
- ``build_memory(...)`` picks the embedder (OpenAI / sentence-transformers
  / mock) based on env flags and returns the store + retriever pair

Custom entry IDs (topic names like ``zksnarks``) live in metadata as
``entry_id`` because jig's ``SqliteStore`` generates its own UUIDs per
row. We map the UUID world to algerknown's world at the boundary.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Any

import numpy as np
from jig.memory.local import DenseRetriever, Embedder, SqliteStore

logger = logging.getLogger(__name__)


# --- Embedders ---------------------------------------------------------------


def mock_embedder(dim: int = 384) -> Embedder:
    """Deterministic sha256-seeded embeddings for tests — no network."""

    async def embed(text: str) -> np.ndarray:
        sha = hashlib.sha256(text.encode("utf-8")).digest()
        seed_val = int.from_bytes(sha[:8], "big")
        values = [((seed_val * (i + 1)) % 10000) / 5000.0 - 1.0 for i in range(dim)]
        return np.array(values, dtype=np.float32)

    return embed


def openai_embedder(api_key: str, model: str = "text-embedding-3-small") -> Embedder:
    """OpenAI embeddings via the official SDK (matches the pre-phase-13 default)."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    async def embed(text: str) -> np.ndarray:
        resp = await client.embeddings.create(model=model, input=text)
        return np.array(resp.data[0].embedding, dtype=np.float32)

    return embed


def sentence_transformer_embedder(
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
) -> Embedder:
    """Local sentence-transformers embeddings — used when offline / no OpenAI key."""
    import asyncio

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name)

    async def embed(text: str) -> np.ndarray:
        vec = await asyncio.to_thread(model.encode, text, convert_to_numpy=True)
        return vec.astype(np.float32)

    return embed


def _select_embedder(
    openai_key: str | None, use_local: bool, use_mock: bool
) -> Embedder:
    """Resolve env flags → Embedder, preserving the vectorstore.py precedence.

    Precedence (highest first): mock, local, OpenAI (valid key), local fallback.
    """
    if use_mock:
        logger.info("Using mock embeddings (USE_MOCK_EMBEDDINGS=true)")
        return mock_embedder()

    if use_local:
        logger.info("Using local sentence-transformers embeddings (USE_LOCAL_EMBEDDINGS=true)")
        return sentence_transformer_embedder()

    if openai_key and openai_key.startswith("sk-") and openai_key != "sk-..." and not openai_key.startswith("test"):
        logger.info("Using OpenAI embeddings (text-embedding-3-small)")
        return openai_embedder(openai_key)

    logger.info("Using local sentence-transformers embeddings (no valid OpenAI key)")
    return sentence_transformer_embedder()


# --- Factory ----------------------------------------------------------------


async def build_memory(
    db_path: str = "./memory.db",
    openai_key: str | None = None,
    use_local: bool | None = None,
    use_mock: bool | None = None,
    embedder: Embedder | None = None,
) -> tuple[SqliteStore, DenseRetriever]:
    """Instantiate store + retriever with the env-selected embedder.

    Pass ``embedder=`` to force a specific embedder (useful for tests).
    """
    if embedder is None:
        if openai_key is None:
            openai_key = os.getenv("OPENAI_API_KEY", "")
        if use_local is None:
            use_local = os.getenv("USE_LOCAL_EMBEDDINGS", "").lower() in ("true", "1", "yes")
        if use_mock is None:
            use_mock = os.getenv("USE_MOCK_EMBEDDINGS", "").lower() in ("true", "1", "yes")
        embedder = _select_embedder(openai_key, use_local, use_mock)

    store = SqliteStore(db_path=db_path, embedder=embedder)
    retriever = DenseRetriever(store)
    return store, retriever


# --- Chunking ---------------------------------------------------------------


def chunk_text(text: str, max_chars: int = 6000) -> list[str]:
    """Split long content at paragraph → sentence boundaries to respect embedder limits.

    Ported unchanged from ``vectorstore.py:_chunk_text`` so embedding shapes
    and chunk boundaries match the pre-migration behavior.
    """
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    paragraphs = text.split("\n\n")
    current_chunk = ""

    for para in paragraphs:
        if len(para) > max_chars:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
                current_chunk = ""
            sentences = para.replace(". ", ".\n").split("\n")
            for sentence in sentences:
                if len(current_chunk) + len(sentence) + 1 > max_chars:
                    if current_chunk.strip():
                        chunks.append(current_chunk.strip())
                    current_chunk = sentence
                else:
                    current_chunk += (" " if current_chunk else "") + sentence
        elif len(current_chunk) + len(para) + 2 > max_chars:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            current_chunk = para
        else:
            current_chunk += ("\n\n" if current_chunk else "") + para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks if chunks else [text]


# --- Index / upsert ---------------------------------------------------------


async def _delete_by_entry_id(store: SqliteStore, entry_id: str) -> None:
    """Delete every chunk row belonging to a given algerknown entry_id."""
    for entry in await store.all():
        if entry.metadata.get("entry_id") == entry_id:
            await store.delete(entry.id)


async def index_documents(
    store: SqliteStore,
    documents: list[dict[str, Any]],
    replace_existing: bool = True,
) -> int:
    """Upsert documents into the store.

    ``replace_existing=True`` deletes any prior rows carrying the same
    ``entry_id`` before inserting, matching the upsert behavior the old
    ChromaDB VectorStore relied on. Pass ``False`` only for first-boot
    seeding where the store is known empty.

    Returns the number of chunk rows written.
    """
    if not documents:
        return 0

    total_chunks = 0
    for doc in documents:
        entry_id = doc["id"]
        if replace_existing:
            await _delete_by_entry_id(store, entry_id)

        chunks = chunk_text(doc["content"])
        if len(chunks) > 1:
            logger.info("Splitting document %r into %d chunks", entry_id, len(chunks))

        for i, chunk in enumerate(chunks):
            meta = {
                **doc["metadata"],
                "entry_id": entry_id,
                "chunk_index": i,
                "parent_id": entry_id,
            }
            await store.add(chunk, meta)
            total_chunks += 1

    logger.info("Indexed %d documents (%d chunks)", len(documents), total_chunks)
    return total_chunks


# --- Query / reconstruction -------------------------------------------------


def _reconstruct_from_entries(entries: list[Any]) -> list[dict[str, Any]]:
    """Group jig MemoryEntry rows by parent_id, sort chunks, join content.

    Returns one dict per logical document in the shape callers expect:
    ``{id, content, metadata, distance?}``.
    """
    grouped: dict[str, list[Any]] = {}
    for entry in entries:
        parent = entry.metadata.get("parent_id") or entry.metadata.get("entry_id") or entry.id
        grouped.setdefault(parent, []).append(entry)

    reconstructed: list[dict[str, Any]] = []
    for parent, rows in grouped.items():
        rows.sort(key=lambda e: e.metadata.get("chunk_index", 0))
        base_meta = {
            k: v
            for k, v in rows[0].metadata.items()
            if k not in ("chunk_index", "parent_id", "entry_id")
        }
        # score on MemoryEntry is cosine similarity (higher = better); callers
        # expect `distance` where lower = better, so invert.
        best_score = max(
            (r.score for r in rows if r.score is not None),
            default=None,
        )
        distance = (1.0 - best_score) if best_score is not None else None
        doc: dict[str, Any] = {
            "id": parent,
            "content": "\n\n".join(r.content for r in rows),
            "metadata": base_meta,
        }
        if distance is not None:
            doc["distance"] = distance
        reconstructed.append(doc)

    return reconstructed


async def search(
    retriever: DenseRetriever,
    query: str,
    n_results: int = 5,
    where: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return top ``n_results`` docs by similarity, deduped across chunks.

    ``where`` is a metadata equality filter (e.g. ``{"type": "summary"}``)
    applied by jig's retriever; we over-fetch to account for chunk dedupe.
    """
    context = {"filter": where} if where else None
    hits = await retriever.retrieve(query, k=n_results * 3, context=context)
    reconstructed = _reconstruct_from_entries(hits)
    return reconstructed[:n_results]


async def get_summaries(store: SqliteStore) -> list[dict[str, Any]]:
    """Return all summary-type documents, chunks reconstructed to parents."""
    all_entries = await store.all()
    summaries = [e for e in all_entries if e.metadata.get("type") == "summary"]
    return _reconstruct_from_entries(summaries)


async def get_by_id(store: SqliteStore, entry_id: str) -> dict[str, Any] | None:
    """Fetch one logical document by its algerknown entry_id."""
    matches = [e for e in await store.all() if e.metadata.get("entry_id") == entry_id]
    if not matches:
        return None
    reconstructed = _reconstruct_from_entries(matches)
    return reconstructed[0] if reconstructed else None


async def get_all(store: SqliteStore) -> list[dict[str, Any]]:
    """Return every logical document currently indexed."""
    return _reconstruct_from_entries(await store.all())


async def count(store: SqliteStore) -> int:
    """Count logical documents (parents), not chunk rows."""
    seen: set[str] = set()
    for entry in await store.all():
        seen.add(entry.metadata.get("entry_id") or entry.id)
    return len(seen)
