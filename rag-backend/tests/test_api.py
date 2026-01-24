"""
Tests for the API endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os

# Mock environment variables before importing api
os.environ["CONTENT_DIR"] = "/tmp/test-content"
os.environ["CHROMA_DB_DIR"] = "/tmp/test-chroma"


class TestHealthEndpoint:
    """Tests for the health check endpoint."""
    
    def test_health_returns_status(self):
        """Should return health status."""
        from api import app
        
        with TestClient(app) as client:
            response = client.get("/health")
            
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert "documents_indexed" in data


class TestQueryEndpoint:
    """Tests for the /query endpoint."""
    
    @patch("api.vector_store")
    @patch("api.synthesize_answer")
    def test_query_success(self, mock_synthesize, mock_store):
        """Should return synthesized answer."""
        from api import app
        
        mock_store.query.return_value = [
            {"id": "doc-1", "content": "Test content", "metadata": {}, "distance": 0.1}
        ]
        mock_synthesize.return_value = {
            "answer": "Test answer",
            "sources": ["doc-1"],
            "model": "claude-sonnet-4-20250514"
        }
        
        with TestClient(app) as client:
            response = client.post("/query", json={
                "query": "What is ZK?",
                "n_results": 5
            })
            
            assert response.status_code == 200
            data = response.json()
            assert "answer" in data
            assert "sources" in data
    
    def test_query_validation(self):
        """Should validate request body."""
        from api import app
        
        with TestClient(app) as client:
            # Missing query
            response = client.post("/query", json={})
            assert response.status_code == 422
            
            # Invalid n_results
            response = client.post("/query", json={
                "query": "test",
                "n_results": 100  # Too high
            })
            assert response.status_code == 422


class TestSearchEndpoint:
    """Tests for the /search endpoint."""
    
    def test_search_returns_results(self):
        """Should return search results (may be empty if no content)."""
        from api import app
        
        with TestClient(app) as client:
            response = client.post("/search", json={
                "query": "nullifiers",
                "n_results": 10
            })
            
            assert response.status_code == 200
            data = response.json()
            assert "results" in data
            # Results may be empty if vector store is empty (which is fine in tests)
            assert isinstance(data["results"], list)


class TestEntriesEndpoint:
    """Tests for the /entries endpoint."""
    
    def test_list_entries(self):
        """Should list all entries."""
        from api import app, entries_cache
        
        # Populate cache
        entries_cache["test-1"] = {
            "id": "test-1",
            "content": "Test",
            "metadata": {"type": "entry", "topic": "Test", "status": "active"}
        }
        
        with TestClient(app) as client:
            response = client.get("/entries")
            
            assert response.status_code == 200
            data = response.json()
            assert "entries" in data
            assert "total" in data


class TestReindexEndpoint:
    """Tests for the /reindex endpoint."""
    
    @patch("api.load_content")
    def test_reindex_success(self, mock_load):
        """Should reindex all content."""
        from api import app
        
        mock_load.return_value = [
            {"id": "doc-1", "content": "Test content", "metadata": {"type": "entry"}}
        ]
        
        with TestClient(app) as client:
            response = client.post("/reindex")
            
            assert response.status_code == 200
            data = response.json()
            assert "indexed" in data


class TestIngestEndpoint:
    """Tests for the /ingest endpoint."""
    
    def test_ingest_invalid_path(self):
        """Should reject paths outside content directory."""
        from api import app
        
        with TestClient(app) as client:
            response = client.post("/ingest", json={
                "file_path": "/etc/passwd"
            })
            
            assert response.status_code == 400
            assert "content directory" in response.json()["detail"]
    
    def test_ingest_file_not_found(self):
        """Should return 404 for missing file."""
        from api import app
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Set CONTENT_DIR to tmpdir so path validation passes
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            
            try:
                with TestClient(app) as client:
                    response = client.post("/ingest", json={
                        "file_path": f"{tmpdir}/nonexistent.yaml"
                    })
                    
                    assert response.status_code == 404
            finally:
                api.CONTENT_DIR = old_content_dir


class TestApproveEndpoint:
    """Tests for the /approve endpoint."""
    
    @patch("api.apply_update")
    @patch("api.load_content")
    @patch("api.vector_store")
    def test_approve_success(self, mock_store, mock_load, mock_apply):
        """Should apply approved proposal."""
        from api import app
        
        mock_apply.return_value = {
            "success": True,
            "file": "/path/to/file.yaml",
            "changes": ["Added learning"]
        }
        mock_load.return_value = []
        
        with TestClient(app) as client:
            response = client.post("/approve", json={
                "proposal": {
                    "target_summary_id": "test-summary",
                    "source_entry_id": "test-entry",
                    "new_learnings": [{"insight": "Test", "context": "Test"}]
                }
            })
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
    
    @patch("api.apply_update")
    def test_approve_failure(self, mock_apply):
        """Should return error on failure."""
        from api import app
        
        mock_apply.return_value = {
            "success": False,
            "error": "File not found"
        }
        
        with TestClient(app) as client:
            response = client.post("/approve", json={
                "proposal": {
                    "target_summary_id": "nonexistent",
                    "source_entry_id": "test-entry"
                }
            })
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert "error" in data
