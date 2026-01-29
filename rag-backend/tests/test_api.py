"""
Tests for the API endpoints.
"""

from fastapi.testclient import TestClient
from unittest.mock import patch
import os
import tempfile

# Mock environment variables before importing api
os.environ["CONTENT_DIR"] = "/tmp/test-content"
os.environ["CHROMA_DB_DIR"] = "/tmp/test-chroma"
os.environ["USE_MOCK_EMBEDDINGS"] = "true"  # Use mock embeddings for tests (no network calls)


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


class TestIndexEndpoint:
    """Tests for the /index endpoint."""
    
    def test_index_invalid_path(self):
        """Should reject paths outside content directory."""
        from api import app
        
        with TestClient(app) as client:
            response = client.post("/index", json={
                "file_path": "/etc/passwd"
            })
            
            assert response.status_code == 400
            assert "content directory" in response.json()["detail"]
    
    def test_index_file_not_found(self):
        """Should return 404 for missing file."""
        from api import app
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Set CONTENT_DIR to tmpdir so path validation passes
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            
            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={
                        "file_path": f"{tmpdir}/nonexistent.yaml"
                    })
                    
                    assert response.status_code == 404
            finally:
                api.CONTENT_DIR = old_content_dir
    
    @patch("api.vector_store")
    def test_index_does_not_update_last_ingested(self, mock_store):
        """Should NOT update last_ingested field in entry file after indexing."""
        from api import app
        from ruamel.yaml import YAML
        
        yaml = YAML()
        yaml.preserve_quotes = True
        
        mock_store.index_documents = lambda x: None
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test entry file
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            
            with open(entry_file, "w") as f:
                yaml.dump({
                    "id": "test-entry",
                    "type": "entry",
                    "topic": "Test Topic",
                    "content": "Test content"
                }, f)
            
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()
            
            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={
                        "file_path": entry_file
                    })
                    
                    assert response.status_code == 200
                    
                    # Verify last_ingested was NOT written to file
                    with open(entry_file) as f:
                        indexed_entry = yaml.load(f)
                    
                    assert "last_ingested" not in indexed_entry
            finally:
                api.CONTENT_DIR = old_content_dir
    
    @patch("api.generate_all_proposals")
    @patch("api.vector_store")
    def test_index_does_not_generate_proposals(self, mock_store, mock_proposals):
        """Should NOT generate proposals when indexing."""
        from api import app
        from ruamel.yaml import YAML
        
        yaml = YAML()
        yaml.preserve_quotes = True
        
        mock_store.index_documents = lambda x: None
        mock_proposals.return_value = [{"target_summary_id": "test"}]
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test entry file
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            
            with open(entry_file, "w") as f:
                yaml.dump({
                    "id": "test-entry",
                    "type": "entry",
                    "topic": "Test Topic",
                    "content": "Test content"
                }, f)
            
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()
            
            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={
                        "file_path": entry_file
                    })
                    
                    assert response.status_code == 200
                    data = response.json()
                    
                    # Response should only have status and id, no proposals
                    assert "status" in data
                    assert "id" in data
                    assert "proposals" not in data
                    assert data["status"] == "indexed"
                    assert data["id"] == "test-entry"
                    
                    # generate_all_proposals should NOT have been called
                    mock_proposals.assert_not_called()
            finally:
                api.CONTENT_DIR = old_content_dir
    
    def test_index_indexes_document(self):
        """Should index the document in the vector store."""
        from api import app
        from ruamel.yaml import YAML
        
        yaml = YAML()
        yaml.preserve_quotes = True
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test entry file
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            
            with open(entry_file, "w") as f:
                yaml.dump({
                    "id": "test-entry",
                    "type": "entry",
                    "topic": "Test Topic",
                    "content": "Test content",
                    "tags": ["test", "example"]
                }, f)
            
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            
            # Remove test-entry from cache if it exists
            api.entries_cache.pop("test-entry", None)
            
            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={
                        "file_path": entry_file
                    })
                    
                    assert response.status_code == 200
                    data = response.json()
                    
                    # Verify response
                    assert data["status"] == "indexed"
                    assert data["id"] == "test-entry"
                    
                    # Verify it was added to cache (confirms indexing occurred)
                    assert "test-entry" in api.entries_cache
                    cached_entry = api.entries_cache["test-entry"]
                    assert cached_entry["id"] == "test-entry"
                    assert cached_entry["metadata"]["type"] == "entry"
                    assert cached_entry["metadata"]["topic"] == "Test Topic"
                    assert cached_entry["metadata"]["tags"] == "test,example"
            finally:
                api.CONTENT_DIR = old_content_dir
                api.entries_cache.pop("test-entry", None)


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
    
    @patch("api.generate_all_proposals")
    @patch("api.vector_store")
    def test_ingest_updates_last_ingested(self, mock_store, mock_proposals):
        """Should update last_ingested field in entry file after ingestion."""
        from api import app
        from datetime import date
        from ruamel.yaml import YAML
        
        yaml = YAML()
        yaml.preserve_quotes = True
        
        mock_proposals.return_value = []
        mock_store.index_documents = lambda x: None
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test entry file
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            
            with open(entry_file, "w") as f:
                yaml.dump({
                    "id": "test-entry",
                    "type": "entry",
                    "topic": "Test Topic",
                    "content": "Test content"
                }, f)
            
            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()
            
            try:
                with TestClient(app) as client:
                    response = client.post("/ingest", json={
                        "file_path": entry_file
                    })
                    
                    assert response.status_code == 200
                    
                    # Verify last_ingested was written to file
                    with open(entry_file) as f:
                        updated_entry = yaml.load(f)
                    
                    assert "last_ingested" in updated_entry
                    assert updated_entry["last_ingested"] == date.today().isoformat()
            finally:
                api.CONTENT_DIR = old_content_dir


class TestEntriesEndpoint:
    """Tests for the /entries endpoint."""
    
    def test_entries_includes_last_ingested(self):
        """Should include last_ingested in entries response."""
        from api import app
        import api
        
        with TestClient(app) as client:
            # Add test entries to cache AFTER lifespan starts
            api.entries_cache["test-with-date"] = {
                "id": "test-with-date",
                "content": "Test content",
                "metadata": {
                    "type": "entry",
                    "topic": "Test",
                    "status": "active",
                    "file_path": "/test/path.yaml",
                    "last_ingested": "2024-01-15"
                },
                "raw": {
                    "id": "test-with-date",
                    "last_ingested": "2024-01-15"
                }
            }
            
            api.entries_cache["test-without-date"] = {
                "id": "test-without-date",
                "content": "Test content",
                "metadata": {
                    "type": "entry",
                    "topic": "Test",
                    "status": "active",
                    "file_path": "/test/path2.yaml"
                },
                "raw": {
                    "id": "test-without-date"
                }
            }
            
            try:
                response = client.get("/entries")
                
                assert response.status_code == 200
                data = response.json()
                
                entries_by_id = {e["id"]: e for e in data["entries"]}
                
                # Entry with last_ingested should have the date
                assert entries_by_id["test-with-date"]["last_ingested"] == "2024-01-15"
                
                # Entry without last_ingested should have None
                assert entries_by_id["test-without-date"]["last_ingested"] is None
            finally:
                api.entries_cache.pop("test-with-date", None)
                api.entries_cache.pop("test-without-date", None)


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


class TestChangelogEndpoint:
    """Tests for the /changelog endpoint."""
    
    def test_changelog_returns_changes(self):
        """Should return changelog entries."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                # Set changelog AFTER lifespan initializes
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                # Add test changes
                api.changelog.append([
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "added", "path": "test.field", "source": "test.yaml"},
                    {"timestamp": "2024-01-15T13:00:00Z", "type": "modified", "path": "test.other", "source": "test.yaml"},
                ])
                
                try:
                    response = client.get("/changelog")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert "changes" in data
                    assert "total" in data
                    assert len(data["changes"]) == 2
                    assert data["total"] == 2
                finally:
                    api.changelog = old_changelog
    
    def test_changelog_filter_by_type(self):
        """Should filter changes by type."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                api.changelog.append([
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "added", "path": "a"},
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "modified", "path": "b"},
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "added", "path": "c"},
                ])
                
                try:
                    response = client.get("/changelog?change_type=added")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert len(data["changes"]) == 2
                    assert all(c["type"] == "added" for c in data["changes"])
                finally:
                    api.changelog = old_changelog
    
    def test_changelog_invalid_change_type(self):
        """Should reject invalid change_type parameter."""
        from api import app
        
        with TestClient(app) as client:
            response = client.get("/changelog?change_type=invalid")
            
            assert response.status_code == 400
            assert "Invalid change_type" in response.json()["detail"]


class TestChangelogSourcesEndpoint:
    """Tests for the /changelog/sources endpoint."""
    
    def test_changelog_sources_returns_unique_sources(self):
        """Should return unique source files."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                api.changelog.append([
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "a.yaml", "path": "x"},
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "b.yaml", "path": "y"},
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "a.yaml", "path": "z"},
                ])
                
                try:
                    response = client.get("/changelog/sources")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert "sources" in data
                    assert sorted(data["sources"]) == ["a.yaml", "b.yaml"]
                finally:
                    api.changelog = old_changelog


class TestChangelogStatsEndpoint:
    """Tests for the /changelog/stats endpoint."""
    
    def test_changelog_stats_returns_statistics(self):
        """Should return changelog statistics."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                # Reset stats cache
                api._stats_cache = None
                api._stats_cache_file_info = None
                
                api.changelog.append([
                    {"timestamp": "2024-01-15T10:00:00Z", "type": "added", "path": "a"},
                    {"timestamp": "2024-01-15T11:00:00Z", "type": "modified", "path": "b"},
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "added", "path": "c"},
                ])
                
                try:
                    response = client.get("/changelog/stats")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert data["total_changes"] == 3
                    assert data["by_type"]["added"] == 2
                    assert data["by_type"]["modified"] == 1
                    assert data["by_type"]["removed"] == 0
                    assert data["first_change"] == "2024-01-15T10:00:00Z"
                    assert data["last_change"] == "2024-01-15T12:00:00Z"
                finally:
                    api.changelog = old_changelog


class TestEntryHistoryEndpoint:
    """Tests for the /entries/{entry_id}/history endpoint."""
    
    def test_entry_history_returns_changes(self):
        """Should return history for a specific entry."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                # Add entry to cache with file_path
                api.entries_cache["test-entry"] = {
                    "id": "test-entry",
                    "content": "Test",
                    "metadata": {
                        "type": "entry",
                        "file_path": "entries/test-entry.yaml"
                    }
                }
                
                api.changelog.append([
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "entries/test-entry.yaml", "path": "field1", "type": "added"},
                    {"timestamp": "2024-01-15T13:00:00Z", "source": "entries/test-entry.yaml", "path": "field2", "type": "modified"},
                    {"timestamp": "2024-01-15T14:00:00Z", "source": "entries/other.yaml", "path": "field3", "type": "added"},
                ])
                
                try:
                    response = client.get("/entries/test-entry/history")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert data["entry_id"] == "test-entry"
                    assert len(data["changes"]) == 2
                    assert data["total"] == 2
                    # All changes should be from test-entry.yaml
                    assert all(c["source"] == "entries/test-entry.yaml" for c in data["changes"])
                finally:
                    api.changelog = old_changelog
                    api.entries_cache.pop("test-entry", None)
    
    def test_entry_history_respects_limit(self):
        """Should respect the limit parameter."""
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path
        
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog_path = Path(tmpdir) / "changelog.jsonl"
            
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(changelog_path)
                
                api.entries_cache["test-entry"] = {
                    "id": "test-entry",
                    "content": "Test",
                    "metadata": {
                        "type": "entry",
                        "file_path": "entries/test-entry.yaml"
                    }
                }
                
                # Add many changes
                changes = [
                    {"timestamp": f"2024-01-15T{10+i:02d}:00:00Z", "source": "entries/test-entry.yaml", "path": f"field{i}", "type": "added"}
                    for i in range(10)
                ]
                api.changelog.append(changes)
                
                try:
                    response = client.get("/entries/test-entry/history?limit=3")
                    
                    assert response.status_code == 200
                    data = response.json()
                    assert len(data["changes"]) == 3
                    assert data["total"] == 10  # Total should be full count
                finally:
                    api.changelog = old_changelog
                    api.entries_cache.pop("test-entry", None)