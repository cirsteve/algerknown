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
    Set USE_LOCAL_EMBEDDINGS=true to force local sentence-transformers.
    Otherwise prefers OpenAI, falls back to local if key is missing/invalid.
    """
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


class VectorStore:
    """ChromaDB vector store for algerknown documents."""
    
    def __init__(self, persist_dir: str = "./chroma_db"):
        """
        Initialize the vector store.
        
        Args:
            persist_dir: Directory to persist ChromaDB data
        """
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.embedding_fn = get_embedding_function()
        self.collection = self.client.get_or_create_collection(
            name="algerknown",
            embedding_function=self.embedding_fn
        )
        logger.info(f"Initialized ChromaDB at {persist_dir}")
        
    def index_documents(self, documents: list[dict]) -> int:
        """
        Index documents into the vector store.
        Uses upsert to handle updates.
        
        Args:
            documents: List of document dicts with id, content, metadata
            
        Returns:
            Number of documents indexed
        """
        if not documents:
            return 0
            
        self.collection.upsert(
            ids=[d["id"] for d in documents],
            documents=[d["content"] for d in documents],
            metadatas=[d["metadata"] for d in documents]
        )
        logger.info(f"Indexed {len(documents)} documents")
        return len(documents)
        
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
        kwargs = {
            "query_texts": [query_text],
            "n_results": n_results,
            "include": ["documents", "metadatas", "distances"]
        }
        if where:
            kwargs["where"] = where
            
        results = self.collection.query(**kwargs)
        
        # Handle empty results
        if not results["ids"] or not results["ids"][0]:
            return []
            
        return [
            {
                "id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i]
            }
            for i in range(len(results["ids"][0]))
        ]
        
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
            
        return [
            {
                "id": results["ids"][i],
                "content": results["documents"][i],
                "metadata": results["metadatas"][i]
            }
            for i in range(len(results["ids"]))
        ]
        
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
            
        return [
            {
                "id": results["ids"][i],
                "content": results["documents"][i],
                "metadata": results["metadatas"][i]
            }
            for i in range(len(results["ids"]))
        ]
        
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
