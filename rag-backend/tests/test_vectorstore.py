"""
Tests for the vectorstore module.

Uses MockEmbeddingFunction to avoid network calls and model downloads.
"""

import pytest
import tempfile

from vectorstore import VectorStore, MockEmbeddingFunction


@pytest.fixture
def mock_embedding_fn():
    """Create a mock embedding function to avoid network calls."""
    return MockEmbeddingFunction()


@pytest.fixture
def temp_db_dir():
    """Create a temporary directory for ChromaDB."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def vector_store(temp_db_dir, mock_embedding_fn):
    """Create a VectorStore with mock embeddings for testing."""
    return VectorStore(temp_db_dir, embedding_function=mock_embedding_fn)


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
    
    def test_init_creates_store(self, temp_db_dir, mock_embedding_fn):
        """Should create a new vector store."""
        store = VectorStore(temp_db_dir, embedding_function=mock_embedding_fn)
        
        assert store is not None
        assert store.count() == 0
    
    def test_init_persists(self, temp_db_dir, sample_documents, mock_embedding_fn):
        """Should persist data across instances."""
        # Create and populate
        store1 = VectorStore(temp_db_dir, embedding_function=mock_embedding_fn)
        store1.index_documents(sample_documents)
        
        # Create new instance with same embedding function
        store2 = VectorStore(temp_db_dir, embedding_function=mock_embedding_fn)
        
        assert store2.count() == 3


class TestIndexDocuments:
    """Tests for document indexing."""
    
    def test_index_documents(self, vector_store, sample_documents):
        """Should index documents successfully."""
        count = vector_store.index_documents(sample_documents)
        
        assert count == 3
        assert vector_store.count() == 3
    
    def test_index_empty_list(self, vector_store):
        """Should handle empty document list."""
        count = vector_store.index_documents([])
        
        assert count == 0
    
    def test_upsert_updates_existing(self, vector_store, sample_documents):
        """Should update existing documents on re-index."""
        vector_store.index_documents(sample_documents)
        
        # Modify and re-index
        modified = [
            {
                "id": "doc-001",
                "content": "Updated content about ZK proofs.",
                "metadata": sample_documents[0]["metadata"]
            }
        ]
        vector_store.index_documents(modified)
        
        # Should still be 3 documents, not 4
        assert vector_store.count() == 3
        
        # Check content was updated
        doc = vector_store.get_by_id("doc-001")
        assert "Updated content" in doc["content"]


class TestQuery:
    """Tests for vector search."""
    
    def test_query_returns_results(self, vector_store, sample_documents):
        """Should return relevant results."""
        vector_store.index_documents(sample_documents)
        
        results = vector_store.query("zero-knowledge proofs", n_results=2)
        
        assert len(results) == 2
        assert all("id" in r for r in results)
        assert all("content" in r for r in results)
        assert all("distance" in r for r in results)
    
    def test_query_with_filter(self, vector_store, sample_documents):
        """Should filter by metadata."""
        vector_store.index_documents(sample_documents)
        
        results = vector_store.query(
            "zero-knowledge", 
            n_results=10,
            where={"type": "summary"}
        )
        
        assert len(results) == 1
        assert results[0]["id"] == "summary-001"
    
    def test_query_respects_n_results(self, vector_store, sample_documents):
        """Should respect n_results limit."""
        vector_store.index_documents(sample_documents)
        
        results = vector_store.query("proof", n_results=1)
        
        assert len(results) == 1
    
    def test_query_empty_store(self, vector_store):
        """Should handle empty store gracefully."""
        results = vector_store.query("anything")
        
        assert results == []


class TestGetSummaries:
    """Tests for get_summaries method."""
    
    def test_get_summaries_returns_only_summaries(self, vector_store, sample_documents):
        """Should return only summary-type documents."""
        vector_store.index_documents(sample_documents)
        
        summaries = vector_store.get_summaries()
        
        assert len(summaries) == 1
        assert summaries[0]["id"] == "summary-001"
        assert summaries[0]["metadata"]["type"] == "summary"
    
    def test_get_summaries_empty(self, vector_store):
        """Should return empty list when no summaries."""
        vector_store.index_documents([
            {
                "id": "entry-only",
                "content": "Just an entry",
                "metadata": {"type": "entry", "topic": "Test", "tags": "", "status": ""}
            }
        ])
        
        summaries = vector_store.get_summaries()
        
        assert summaries == []


class TestGetById:
    """Tests for get_by_id method."""
    
    def test_get_existing_document(self, vector_store, sample_documents):
        """Should return document by ID."""
        vector_store.index_documents(sample_documents)
        
        doc = vector_store.get_by_id("doc-001")
        
        assert doc is not None
        assert doc["id"] == "doc-001"
        assert "content" in doc
    
    def test_get_nonexistent_document(self, vector_store, sample_documents):
        """Should return None for non-existent ID."""
        vector_store.index_documents(sample_documents)
        
        doc = vector_store.get_by_id("nonexistent")
        
        assert doc is None


class TestGetAll:
    """Tests for get_all method."""
    
    def test_get_all_documents(self, vector_store, sample_documents):
        """Should return all documents."""
        vector_store.index_documents(sample_documents)
        
        all_docs = vector_store.get_all()
        
        assert len(all_docs) == 3
    
    def test_get_all_empty_store(self, vector_store):
        """Should return empty list for empty store."""
        all_docs = vector_store.get_all()
        
        assert all_docs == []


class TestDelete:
    """Tests for delete method."""
    
    def test_delete_document(self, vector_store, sample_documents):
        """Should delete document by ID."""
        vector_store.index_documents(sample_documents)
        
        result = vector_store.delete("doc-001")
        
        assert result is True
        assert vector_store.count() == 2
        assert vector_store.get_by_id("doc-001") is None
