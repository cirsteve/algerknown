"""
Algerknown RAG - Vector Store

ChromaDB operations for embedding storage and retrieval.
"""

import chromadb
from chromadb.utils import embedding_functions
from typing import Optional
import os
import logging

logger = logging.getLogger(__name__)


def get_embedding_function():
    """
    Get the embedding function based on configuration and available API keys.
    Set USE_MOCK_EMBEDDINGS=true for testing (no network calls).
    Set USE_LOCAL_EMBEDDINGS=true to force local sentence-transformers.
    Otherwise prefers OpenAI, falls back to local if key is missing/invalid.
    """
    # Check if mock embeddings are requested (for testing)
    use_mock = os.getenv("USE_MOCK_EMBEDDINGS", "").lower() in ("true", "1", "yes")
    
    if use_mock:
        logger.info("Using mock embeddings (USE_MOCK_EMBEDDINGS=true)")
        return MockEmbeddingFunction()
    
    # Check if local embeddings are explicitly requested
    use_local = os.getenv("USE_LOCAL_EMBEDDINGS", "").lower() in ("true", "1", "yes")
    
    if use_local:
        logger.info("Using local sentence-transformers embeddings (USE_LOCAL_EMBEDDINGS=true)")
        return embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )
    
    openai_key = os.getenv("OPENAI_API_KEY", "")
    
    # Use OpenAI if we have a real API key (not placeholder or test key)
    if openai_key and openai_key.startswith("sk-") and openai_key != "sk-..." and not openai_key.startswith("test"):
        logger.info("Using OpenAI embeddings (text-embedding-3-small)")
        return embedding_functions.OpenAIEmbeddingFunction(
            api_key=openai_key,
            model_name="text-embedding-3-small"
        )
    else:
        logger.info("Using local sentence-transformers embeddings (no valid OpenAI key)")
        return embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )


class MockEmbeddingFunction:
    """
    Mock embedding function for testing.
    Returns deterministic fixed-dimension vectors without network calls.
    Compatible with ChromaDB's embedding function interface.
    """
    
    # Tell ChromaDB this is not a legacy embedding function
    is_legacy = False
    
    def name(self) -> str:
        """Return the name of the embedding function (required by ChromaDB)."""
        return "mock_embedding"
    
    def __call__(self, input: list[str]) -> list[list[float]]:
        """Generate deterministic mock embeddings."""
        return self._embed(input)
    
    def embed_documents(self, input: list[str]) -> list[list[float]]:
        """Embed a list of documents (alias for __call__)."""
        return self._embed(input)
    
    def embed_query(self, input: list[str]) -> list[list[float]]:
        """Embed a query (alias for __call__)."""
        return self._embed(input)
    
    def _embed(self, input: list[str]) -> list[list[float]]:
        """Generate deterministic mock embeddings."""
        import hashlib
        
        # Return 384-dimensional vectors (same as all-MiniLM-L6-v2)
        # Use sha256 of text to make embeddings deterministic across runs/platforms
        embeddings = []
        for text in input:
            # Create a deterministic seed from text
            sha = hashlib.sha256(text.encode("utf-8")).digest()
            # Convert first 8 bytes to an integer for seeding logic
            seed_val = int.from_bytes(sha[:8], "big")
            
            # Generate 384 values between -1 and 1
            embedding = [
                ((seed_val * (i + 1)) % 10000) / 5000.0 - 1.0
                for i in range(384)
            ]
            embeddings.append(embedding)
        return embeddings


class VectorStore:
    """ChromaDB vector store for algerknown documents."""
    
    def __init__(self, persist_dir: str = "./chroma_db", embedding_function=None):
        """
        Initialize the vector store.
        
        Args:
            persist_dir: Directory to persist ChromaDB data
            embedding_function: Optional custom embedding function.
                               If None, uses get_embedding_function().
                               Pass MockEmbeddingFunction() for tests.
        """
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.embedding_fn = embedding_function if embedding_function is not None else get_embedding_function()
        self.collection = self.client.get_or_create_collection(
            name="algerknown",
            embedding_function=self.embedding_fn
        )
        logger.info(f"Initialized ChromaDB at {persist_dir}")
        
    @staticmethod
    def _chunk_text(text: str, max_chars: int = 6000) -> list[str]:
        """
        Split text into chunks that stay under the embedding model's token limit.
        
        Uses ~6000 characters per chunk (≈1500 tokens) to stay well within the
        8192-token limit of text-embedding-3-small. Splits on paragraph boundaries
        first, then falls back to sentence boundaries.
        """
        if len(text) <= max_chars:
            return [text]
        
        chunks = []
        paragraphs = text.split("\n\n")
        current_chunk = ""
        
        for para in paragraphs:
            # If a single paragraph exceeds max_chars, split it further
            if len(para) > max_chars:
                # Flush current chunk first
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                # Split long paragraph by sentences (period + space)
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
    def _reconstruct_documents(results: dict) -> list[dict]:
        """
        Reconstruct full documents from get() results that may contain chunks.

        Groups chunked rows by parent ID, sorts by chunk index, and joins
        chunk content to return one full document per parent.
        """
        grouped = {}

        for i in range(len(results["ids"])):
            meta = results["metadatas"][i]
            doc_id = meta.get("parent_id", results["ids"][i])
            chunk_index = meta.get("chunk_index", 0)

            if doc_id not in grouped:
                grouped[doc_id] = []

            grouped[doc_id].append((chunk_index, results["documents"][i], meta))

        reconstructed = []
        for doc_id, chunks in grouped.items():
            chunks.sort(key=lambda c: c[0])
            base_meta = {k: v for k, v in chunks[0][2].items()
                         if k not in ("chunk_index", "parent_id")}

            reconstructed.append({
                "id": doc_id,
                "content": "\n\n".join(chunk[1] for chunk in chunks),
                "metadata": base_meta,
            })

        return reconstructed

    def index_documents(self, documents: list[dict]) -> int:
        """
        Index documents into the vector store.
        Uses upsert to handle updates. Documents exceeding the embedding
        model's token limit are automatically chunked.
        
        Args:
            documents: List of document dicts with id, content, metadata
            
        Returns:
            Number of document chunks indexed
        """
        if not documents:
            return 0
        
        ids = []
        contents = []
        metadatas = []
        
        for d in documents:
            chunks = self._chunk_text(d["content"])
            if len(chunks) == 1:
                ids.append(d["id"])
                contents.append(d["content"])
                metadatas.append(d["metadata"])
            else:
                logger.info(f"Splitting document '{d['id']}' into {len(chunks)} chunks")
                for i, chunk in enumerate(chunks):
                    chunk_meta = {**d["metadata"], "chunk_index": i, "parent_id": d["id"]}
                    ids.append(f"{d['id']}_chunk_{i}")
                    contents.append(chunk)
                    metadatas.append(chunk_meta)
        
        # Upsert in batches to avoid oversized requests
        batch_size = 100
        for start in range(0, len(ids), batch_size):
            end = start + batch_size
            self.collection.upsert(
                ids=ids[start:end],
                documents=contents[start:end],
                metadatas=metadatas[start:end],
            )
        
        logger.info(f"Indexed {len(documents)} documents ({len(ids)} chunks)")
        return len(ids)
        
    def query(
        self, 
        query_text: str, 
        n_results: int = 5,
        where: Optional[dict] = None
    ) -> list[dict]:
        """
        Query the vector store for similar documents.
        
        Args:
            query_text: Natural language query
            n_results: Maximum number of results
            where: Optional metadata filter
            
        Returns:
            List of matching documents with scores
        """
        # Request extra results to account for deduplication of chunks
        kwargs = {
            "query_texts": [query_text],
            "n_results": min(n_results * 3, self.collection.count()),
            "include": ["documents", "metadatas", "distances"]
        }
        if where:
            kwargs["where"] = where
            
        results = self.collection.query(**kwargs)
        
        # Handle empty results
        if not results["ids"] or not results["ids"][0]:
            return []
        
        # Deduplicate chunks: keep best-scoring chunk per parent document
        seen_parents = {}
        for i in range(len(results["ids"][0])):
            metadata = results["metadatas"][0][i]
            doc_id = metadata.get("parent_id", results["ids"][0][i])
            
            if doc_id not in seen_parents:
                seen_parents[doc_id] = {
                    "id": doc_id,
                    "content": results["documents"][0][i],
                    "metadata": {k: v for k, v in metadata.items()
                                 if k not in ("chunk_index", "parent_id")},
                    "distance": results["distances"][0][i]
                }
            
            if len(seen_parents) >= n_results:
                break
            
        return list(seen_parents.values())
        
    def get_summaries(self) -> list[dict]:
        """
        Get all summary-type documents.
        
        Returns:
            List of summary documents
        """
        results = self.collection.get(
            where={"type": "summary"},
            include=["documents", "metadatas"]
        )
        
        if not results["ids"]:
            return []

        return self._reconstruct_documents(results)
        
    def get_by_id(self, doc_id: str) -> Optional[dict]:
        """
        Get a specific document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            Document dict or None
        """
        results = self.collection.get(
            ids=[doc_id],
            include=["documents", "metadatas"]
        )
        
        if not results["ids"]:
            return None
            
        return {
            "id": results["ids"][0],
            "content": results["documents"][0],
            "metadata": results["metadatas"][0]
        }
        
    def get_all(self) -> list[dict]:
        """
        Get all documents in the store.
        
        Returns:
            List of all documents
        """
        results = self.collection.get(
            include=["documents", "metadatas"]
        )
        
        if not results["ids"]:
            return []

        return self._reconstruct_documents(results)
        
    def count(self) -> int:
        """Get the number of documents in the store."""
        return self.collection.count()
        
    def delete(self, doc_id: str) -> bool:
        """
        Delete a document by ID.
        
        Args:
            doc_id: Document ID to delete
            
        Returns:
            True if deleted
        """
        try:
            self.collection.delete(ids=[doc_id])
            return True
        except Exception as e:
            logger.error(f"Failed to delete {doc_id}: {e}")
            return False
