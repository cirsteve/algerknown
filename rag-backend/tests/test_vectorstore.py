"""
Tests for the vectorstore module.
"""

import pytest
import tempfile
import os
from pathlib import Path

from vectorstore import VectorStore


@pytest.fixture
def temp_db_dir():
    """Create a temporary directory for ChromaDB."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_documents():
    """Sample documents for testing."""
    return [
        {
            "id": "doc-001",
            "content": "Zero-knowledge proofs allow verification without revealing data.",
            "metadata": {
                "type": "entry",
                "topic": "ZK Proofs Basics",
                "tags": "zk,cryptography",
                "status": "active"
            }
        },
        {
            "id": "doc-002",
            "content": "Nullifiers prevent double-spending in anonymous systems.",
            "metadata": {
                "type": "entry",
                "topic": "Nullifiers",
                "tags": "zk,privacy",
                "status": "active"
            }
        },
        {
            "id": "summary-001",
            "content": "Summary of zero-knowledge concepts and learnings.",
            "metadata": {
                "type": "summary",
                "topic": "ZK Summary",
                "tags": "zk,summary",
                "status": "reference"
            }
        }
    ]


class TestVectorStoreInit:
    """Tests for VectorStore initialization."""
    
    def test_init_creates_store(self, temp_db_dir):
        """Should create a new vector store."""
        store = VectorStore(temp_db_dir)
        
        assert store is not None
        assert store.count() == 0
    
    def test_init_persists(self, temp_db_dir, sample_documents):
        """Should persist data across instances."""
        # Create and populate
        store1 = VectorStore(temp_db_dir)
        store1.index_documents(sample_documents)
        
        # Create new instance
        store2 = VectorStore(temp_db_dir)
        
        assert store2.count() == 3


class TestIndexDocuments:
    """Tests for document indexing."""
    
    def test_index_documents(self, temp_db_dir, sample_documents):
        """Should index documents successfully."""
        store = VectorStore(temp_db_dir)
        
        count = store.index_documents(sample_documents)
        
        assert count == 3
        assert store.count() == 3
    
    def test_index_empty_list(self, temp_db_dir):
        """Should handle empty document list."""
        store = VectorStore(temp_db_dir)
        
        count = store.index_documents([])
        
        assert count == 0
    
    def test_upsert_updates_existing(self, temp_db_dir, sample_documents):
        """Should update existing documents on re-index."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        # Modify and re-index
        modified = [
            {
                "id": "doc-001",
                "content": "Updated content about ZK proofs.",
                "metadata": sample_documents[0]["metadata"]
            }
        ]
        store.index_documents(modified)
        
        # Should still be 3 documents, not 4
        assert store.count() == 3
        
        # Check content was updated
        doc = store.get_by_id("doc-001")
        assert "Updated content" in doc["content"]


class TestQuery:
    """Tests for vector search."""
    
    def test_query_returns_results(self, temp_db_dir, sample_documents):
        """Should return relevant results."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        results = store.query("zero-knowledge proofs", n_results=2)
        
        assert len(results) == 2
        assert all("id" in r for r in results)
        assert all("content" in r for r in results)
        assert all("distance" in r for r in results)
    
    def test_query_with_filter(self, temp_db_dir, sample_documents):
        """Should filter by metadata."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        results = store.query(
            "zero-knowledge", 
            n_results=10,
            where={"type": "summary"}
        )
        
        assert len(results) == 1
        assert results[0]["id"] == "summary-001"
    
    def test_query_respects_n_results(self, temp_db_dir, sample_documents):
        """Should respect n_results limit."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        results = store.query("proof", n_results=1)
        
        assert len(results) == 1
    
    def test_query_empty_store(self, temp_db_dir):
        """Should handle empty store gracefully."""
        store = VectorStore(temp_db_dir)
        
        results = store.query("anything")
        
        assert results == []


class TestGetSummaries:
    """Tests for get_summaries method."""
    
    def test_get_summaries_returns_only_summaries(self, temp_db_dir, sample_documents):
        """Should return only summary-type documents."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        summaries = store.get_summaries()
        
        assert len(summaries) == 1
        assert summaries[0]["id"] == "summary-001"
        assert summaries[0]["metadata"]["type"] == "summary"
    
    def test_get_summaries_empty(self, temp_db_dir):
        """Should return empty list when no summaries."""
        store = VectorStore(temp_db_dir)
        store.index_documents([
            {
                "id": "entry-only",
                "content": "Just an entry",
                "metadata": {"type": "entry", "topic": "Test", "tags": "", "status": ""}
            }
        ])
        
        summaries = store.get_summaries()
        
        assert summaries == []


class TestGetById:
    """Tests for get_by_id method."""
    
    def test_get_existing_document(self, temp_db_dir, sample_documents):
        """Should return document by ID."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        doc = store.get_by_id("doc-001")
        
        assert doc is not None
        assert doc["id"] == "doc-001"
        assert "content" in doc
    
    def test_get_nonexistent_document(self, temp_db_dir, sample_documents):
        """Should return None for non-existent ID."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        doc = store.get_by_id("nonexistent")
        
        assert doc is None


class TestGetAll:
    """Tests for get_all method."""
    
    def test_get_all_documents(self, temp_db_dir, sample_documents):
        """Should return all documents."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        all_docs = store.get_all()
        
        assert len(all_docs) == 3
    
    def test_get_all_empty_store(self, temp_db_dir):
        """Should return empty list for empty store."""
        store = VectorStore(temp_db_dir)
        
        all_docs = store.get_all()
        
        assert all_docs == []


class TestDelete:
    """Tests for delete method."""
    
    def test_delete_document(self, temp_db_dir, sample_documents):
        """Should delete document by ID."""
        store = VectorStore(temp_db_dir)
        store.index_documents(sample_documents)
        
        result = store.delete("doc-001")
        
        assert result is True
        assert store.count() == 2
        assert store.get_by_id("doc-001") is None
