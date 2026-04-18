"""
Algerknown RAG - Vector Store

Backed by jig's `SqliteStore` + `DenseRetriever`. Preserves the public
surface the rest of the backend consumed from the ChromaDB era — same
class name, same method names, same return shapes — so callers only
needed to add `await`.

Two quirks worth knowing:

1. **Entry-id indirection.** `SqliteStore` generates UUIDs on insert.
   Algerknown's custom ids (e.g. `"zksnarks"`) live in metadata under
   `entry_id` + `parent_id`. Lookups by algerknown id scan all rows
   and filter — cheap at the current corpus size (~50 docs, ~100 chunks).
2. **Upsert via delete-then-add.** jig has no native upsert; every
   write path (`/ingest`, `/approve`, `/reindex`) first removes any
   rows whose metadata `entry_id` matches, then inserts fresh chunks.
   Matches the semantics ChromaDB's `collection.upsert` provided.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from jig.memory.local import DenseRetriever, SqliteStore

from embedders import Embedder, select_embedder

logger = logging.getLogger(__name__)


class VectorStore:
    """Document store with similarity search and metadata filtering.

    Public methods mirror the pre-migration ChromaDB wrapper so callers
    only change sync → async. Embedder is selected from the env by
    default; pass `embedder=` for tests.
    """

    def __init__(
        self,
        persist_dir: str,
        embedder: Optional[Embedder] = None,
    ):
        """
        Args:
            persist_dir: Either a directory (legacy ChromaDB convention
                — SqliteStore places `memory.db` inside it) or a direct
                path to a `.db` file. Missing parent directories are
                created.
            embedder: Optional `Embedder`. Defaults to `select_embedder()`
                which honors the legacy `USE_MOCK_EMBEDDINGS`,
                `USE_LOCAL_EMBEDDINGS`, `OPENAI_API_KEY` env vars.
        """
        db_path = self._resolve_db_path(persist_dir)
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        self._store = SqliteStore(
            db_path=db_path,
            embedder=embedder or select_embedder(),
        )
        self._retriever = DenseRetriever(self._store)
        logger.info(f"Initialized SqliteStore at {db_path}")

    @staticmethod
    def _resolve_db_path(persist_dir: str) -> str:
        """Let callers pass either a directory (legacy) or a `.db` path.

        `./chroma_db` (directory) → `./chroma_db/memory.db`
        `./memory_db/memory.db`    → unchanged
        """
        p = Path(persist_dir)
        if p.suffix == ".db" or (not p.exists() and p.suffix):
            return str(p)
        return str(p / "memory.db")

    async def close(self) -> None:
        """Release the underlying sqlite connection. Call on shutdown."""
        await self._store.close()

    # ------------------------------------------------------------------
    # Chunking (ported verbatim from the ChromaDB implementation)
    # ------------------------------------------------------------------

    @staticmethod
    def _chunk_text(text: str, max_chars: int = 6000) -> list[str]:
        """
        Split text into chunks that stay under the embedding model's token limit.

        Uses ~6000 characters per chunk (~1500 tokens) to stay well within the
        8192-token limit of text-embedding-3-small. Splits on paragraph boundaries
        first, then falls back to sentence boundaries.
        """
        if len(text) <= max_chars:
            return [text]

        chunks: list[str] = []
        paragraphs = text.split("\n\n")
        current_chunk = ""

        for para in paragraphs:
            # If a single paragraph exceeds max_chars, split it further
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

    @staticmethod
    def _reconstruct_from_entries(entries: list[Any]) -> list[dict]:
        """
        Group jig `MemoryEntry` rows by their algerknown parent id, sort by
        `chunk_index`, rejoin content. Returns one dict per logical document
        in the `{id, content, metadata, distance?}` shape callers expect.

        `distance` comes from `MemoryEntry.score` (cosine similarity); we
        invert to `1 - sim` so "lower is better" matches ChromaDB semantics.
        """
        grouped: dict[str, list[Any]] = {}
        for entry in entries:
            parent = (
                entry.metadata.get("parent_id")
                or entry.metadata.get("entry_id")
                or entry.id
            )
            grouped.setdefault(parent, []).append(entry)

        reconstructed: list[dict] = []
        for parent, rows in grouped.items():
            rows.sort(key=lambda e: e.metadata.get("chunk_index", 0))
            base_meta = {
                k: v
                for k, v in rows[0].metadata.items()
                if k not in ("chunk_index", "parent_id", "entry_id")
            }
            doc: dict[str, Any] = {
                "id": parent,
                "content": "\n\n".join(r.content for r in rows),
                "metadata": base_meta,
            }
            # Best-scoring chunk wins when multiple chunks match a query.
            best_score = max(
                (r.score for r in rows if r.score is not None),
                default=None,
            )
            if best_score is not None:
                doc["distance"] = 1.0 - best_score
            reconstructed.append(doc)

        return reconstructed

    # ------------------------------------------------------------------
    # Index / upsert
    # ------------------------------------------------------------------

    async def _delete_by_entry_id(self, entry_id: str) -> None:
        """Remove every chunk row carrying the given algerknown id."""
        for row in await self._store.all():
            if row.metadata.get("entry_id") == entry_id:
                await self._store.delete(row.id)

    async def index_documents(self, documents: list[dict]) -> int:
        """
        Index documents. Upsert semantics: any existing rows with the same
        `id` are deleted first. Long content is chunked; each chunk becomes
        one row carrying `entry_id`, `parent_id`, and `chunk_index`
        metadata alongside the caller's fields.

        Returns the total number of chunk rows written.
        """
        if not documents:
            return 0

        total_chunks = 0
        for doc in documents:
            entry_id = doc["id"]
            await self._delete_by_entry_id(entry_id)

            chunks = self._chunk_text(doc["content"])
            if len(chunks) > 1:
                logger.info(f"Splitting document '{entry_id}' into {len(chunks)} chunks")

            for i, chunk in enumerate(chunks):
                meta = {
                    **doc["metadata"],
                    "entry_id": entry_id,
                    "chunk_index": i,
                    "parent_id": entry_id,
                }
                await self._store.add(chunk, meta)
                total_chunks += 1

        logger.info(f"Indexed {len(documents)} documents ({total_chunks} chunks)")
        return total_chunks

    # ------------------------------------------------------------------
    # Query / read
    # ------------------------------------------------------------------

    async def query(
        self,
        query_text: str,
        n_results: int = 5,
        where: Optional[dict] = None,
    ) -> list[dict]:
        """
        Return top `n_results` documents by similarity, deduped across chunks.

        `where` is an equality metadata filter (e.g. `{"type": "summary"}`),
        plumbed through jig's `context={"filter": ...}`. We over-fetch to
        let chunk deduplication shrink the result back to `n_results`.
        """
        context = {"filter": where} if where else None
        hits = await self._retriever.retrieve(
            query_text, k=n_results * 3, context=context
        )
        if not hits:
            return []
        reconstructed = self._reconstruct_from_entries(hits)
        return reconstructed[:n_results]

    async def get_summaries(self) -> list[dict]:
        """Return all `type=="summary"` documents, chunks reconstructed."""
        rows = await self._store.all()
        summaries = [r for r in rows if r.metadata.get("type") == "summary"]
        return self._reconstruct_from_entries(summaries)

    async def get_by_id(self, doc_id: str) -> Optional[dict]:
        """Return the logical document for a given algerknown id, or None."""
        rows = [
            r
            for r in await self._store.all()
            if r.metadata.get("entry_id") == doc_id
        ]
        if not rows:
            return None
        reconstructed = self._reconstruct_from_entries(rows)
        return reconstructed[0] if reconstructed else None

    async def get_all(self) -> list[dict]:
        """Return every logical document indexed."""
        rows = await self._store.all()
        if not rows:
            return []
        return self._reconstruct_from_entries(rows)

    async def count(self) -> int:
        """Number of logical documents (not chunk rows)."""
        seen: set[str] = set()
        for row in await self._store.all():
            seen.add(row.metadata.get("entry_id") or row.id)
        return len(seen)

    async def delete(self, doc_id: str) -> bool:
        """Remove every chunk belonging to the given algerknown id.

        Returns True on success. False is reserved for future backend
        errors; the in-memory delete itself can't fail today.
        """
        try:
            await self._delete_by_entry_id(doc_id)
            return True
        except Exception as e:
            logger.error(f"Failed to delete {doc_id}: {e}")
            return False
