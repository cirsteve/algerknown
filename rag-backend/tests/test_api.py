"""
Tests for the API endpoints.
"""

import asyncio
import os
import tempfile
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
import httpx

# Mock environment variables before importing api
os.environ["CONTENT_DIR"] = "/tmp/test-content"
os.environ["CHROMA_DB_DIR"] = "/tmp/test-chroma"
os.environ["USE_MOCK_EMBEDDINGS"] = "true"


class TestCreateLLMClient:
    """Tests for the create_llm_client factory."""

    def test_anthropic_provider(self):
        from api import create_llm_client
        from jig.llm import AnthropicClient

        client = create_llm_client("anthropic", "claude-sonnet-4-20250514")
        assert isinstance(client, AnthropicClient)

    def test_dispatch_provider(self, monkeypatch):
        from api import create_llm_client
        from jig.llm import DispatchClient

        monkeypatch.setenv("DISPATCH_URL", "http://localhost:8900")
        client = create_llm_client("dispatch", "llama-70b")
        assert isinstance(client, DispatchClient)

    def test_dispatch_requires_url(self, monkeypatch):
        from api import create_llm_client

        monkeypatch.delenv("DISPATCH_URL", raising=False)
        with pytest.raises(ValueError, match="DISPATCH_URL must be set"):
            create_llm_client("dispatch", "llama-70b")

    def test_unknown_provider_raises(self):
        from api import create_llm_client

        with pytest.raises(ValueError, match="Unknown LLM provider"):
            create_llm_client("openai", "gpt-4o")


class TestHealthEndpoint:
    """Tests for the health check endpoint."""

    def test_health_returns_status(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.get("/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert "documents_indexed" in data


class TestJobsEndpoint:
    """Tests for the GET /jobs/{job_id} endpoint."""

    def test_get_missing_job(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.get("/jobs/nonexistent")
            assert response.status_code == 404

    def test_get_existing_job(self):
        from fastapi.testclient import TestClient
        from api import app
        from jobs import JobStatus

        with TestClient(app) as client:
            # Manually create a job in the store
            job = app.state.job_store.create("query")
            app.state.job_store.update(
                job.id,
                status=JobStatus.COMPLETE,
                progress="Complete",
                result={"answer": "test", "sources": []},
            )

            response = client.get(f"/jobs/{job.id}")
            assert response.status_code == 200
            data = response.json()
            assert data["job_id"] == job.id
            assert data["status"] == "complete"
            assert data["result"]["answer"] == "test"


class TestQueryEndpoint:
    """Tests for the /query endpoint."""

    @patch("api.run_pipeline")
    def test_query_returns_202_with_job_id(self, mock_run_pipeline):
        """Should return 202 with a job_id."""
        from fastapi.testclient import TestClient
        from api import app

        # Mock pipeline to complete instantly
        mock_result = MagicMock()
        mock_result.output = {"answer": "Test", "sources": ["doc-1"], "model": "test"}
        mock_run_pipeline.return_value = mock_result

        with TestClient(app) as client:
            response = client.post("/query", json={"query": "What is ZK?", "n_results": 5})

            assert response.status_code == 202
            data = response.json()
            assert "job_id" in data
            assert data["status"] == "pending"

    @pytest.mark.asyncio
    @patch("api.run_pipeline")
    async def test_query_job_completes(self, mock_run_pipeline):
        """Should complete the query job in the background."""
        from api import app

        mock_result = MagicMock()
        mock_result.output = {
            "answer": "Test answer",
            "sources": ["doc-1"],
            "model": "claude-sonnet-4-20250514",
        }
        mock_run_pipeline.return_value = mock_result

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Submit query
            response = await client.post("/query", json={"query": "test", "n_results": 5})
            assert response.status_code == 202
            job_id = response.json()["job_id"]

            # Poll until complete
            for _ in range(50):
                status = await client.get(f"/jobs/{job_id}")
                if status.json()["status"] in ("complete", "failed"):
                    break
                await asyncio.sleep(0.05)

            result = status.json()
            assert result["status"] == "complete"
            assert result["result"]["answer"] == "Test answer"
            assert result["result"]["sources"] == ["doc-1"]

    def test_query_validation(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/query", json={})
            assert response.status_code == 422

            response = client.post("/query", json={"query": "test", "n_results": 100})
            assert response.status_code == 422


class TestSearchEndpoint:
    """Tests for the /search endpoint."""

    def test_search_returns_results(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/search", json={"query": "nullifiers", "n_results": 10})

            assert response.status_code == 200
            data = response.json()
            assert "results" in data
            assert isinstance(data["results"], list)


class TestEntriesEndpoint:
    """Tests for the /entries endpoint."""

    def test_list_entries(self):
        from fastapi.testclient import TestClient
        from api import app, entries_cache

        entries_cache["test-1"] = {
            "id": "test-1",
            "content": "Test",
            "metadata": {"type": "entry", "topic": "Test", "status": "active"},
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
        from fastapi.testclient import TestClient
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
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/index", json={"file_path": "/etc/passwd"})

            assert response.status_code == 400
            assert "content directory" in response.json()["detail"]

    def test_index_file_not_found(self):
        from fastapi.testclient import TestClient
        from api import app

        with tempfile.TemporaryDirectory() as tmpdir:
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

    @patch("api.VectorStore")
    def test_index_does_not_update_last_ingested(self, MockVectorStore):
        from fastapi.testclient import TestClient
        from api import app
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True

        mock_store = MagicMock()
        mock_store.index_documents = AsyncMock(return_value=1)
        mock_store.count = AsyncMock(return_value=0)
        mock_store.close = AsyncMock()
        MockVectorStore.return_value = mock_store

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")

            with open(entry_file, "w") as f:
                yaml.dump({"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"}, f)

            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={"file_path": entry_file})
                    assert response.status_code == 200

                    with open(entry_file) as f:
                        indexed_entry = yaml.load(f)
                    assert "last_ingested" not in indexed_entry
            finally:
                api.CONTENT_DIR = old_content_dir

    def test_index_indexes_document(self):
        from fastapi.testclient import TestClient
        from api import app
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")

            with open(entry_file, "w") as f:
                yaml.dump({
                    "id": "test-entry", "type": "entry", "topic": "Test Topic",
                    "content": "Test content", "tags": ["test", "example"]
                }, f)

            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.pop("test-entry", None)

            try:
                with TestClient(app) as client:
                    response = client.post("/index", json={"file_path": entry_file})

                    assert response.status_code == 200
                    data = response.json()
                    assert data["status"] == "indexed"
                    assert data["id"] == "test-entry"
                    assert "test-entry" in api.entries_cache
            finally:
                api.CONTENT_DIR = old_content_dir
                api.entries_cache.pop("test-entry", None)


class TestIngestEndpoint:
    """Tests for the /ingest endpoint."""

    def test_ingest_invalid_path(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/ingest", json={"file_path": "/etc/passwd"})

            assert response.status_code == 400
            assert "content directory" in response.json()["detail"]

    def test_ingest_file_not_found(self):
        from fastapi.testclient import TestClient
        from api import app

        with tempfile.TemporaryDirectory() as tmpdir:
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

    def test_ingest_returns_202(self):
        """Should return 202 with a job_id for a valid entry."""
        from fastapi.testclient import TestClient
        from api import app
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")

            with open(entry_file, "w") as f:
                yaml.dump({"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"}, f)

            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                with TestClient(app) as client:
                    response = client.post("/ingest", json={"file_path": entry_file})

                    assert response.status_code == 202
                    data = response.json()
                    assert "job_id" in data
                    assert data["status"] == "pending"
            finally:
                api.CONTENT_DIR = old_content_dir

    @pytest.mark.asyncio
    @patch("api.identify_related_summaries")
    @patch("api.map_pipeline")
    async def test_ingest_job_completes(self, mock_map_pipeline, mock_identify):
        """Should complete the ingest job (no related summaries, empty proposals)."""
        from api import app
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True

        mock_identify.return_value = []

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")

            with open(entry_file, "w") as f:
                yaml.dump({"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"}, f)

            import api
            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post("/ingest", json={"file_path": entry_file})
                    assert response.status_code == 202
                    job_id = response.json()["job_id"]

                    # Poll until complete
                    for _ in range(50):
                        status = await client.get(f"/jobs/{job_id}")
                        if status.json()["status"] in ("complete", "failed"):
                            break
                        await asyncio.sleep(0.05)

                    result = status.json()
                    assert result["status"] == "complete"
                    assert result["result"]["entry_id"] == "test-entry"
                    assert isinstance(result["result"]["proposals"], list)
            finally:
                api.CONTENT_DIR = old_content_dir

    @pytest.mark.asyncio
    @patch("api.identify_related_summaries")
    @patch("api.map_pipeline")
    async def test_ingest_job_completes_with_proposals(self, mock_map_pipeline, mock_identify):
        """Should complete the ingest job with proposals when related summaries found."""
        from api import app
        from ruamel.yaml import YAML

        yaml = YAML()
        yaml.preserve_quotes = True

        mock_identify.return_value = [
            {"id": "summary-1", "content": "S1", "metadata": {}, "score": 0.9, "match_reason": "semantic"},
        ]

        # Mock map_pipeline to return a proposal result
        mock_result = MagicMock()
        mock_proposal_result = MagicMock()
        mock_proposal_result.output = {
            "target_summary_id": "summary-1",
            "source_entry_id": "test-entry",
            "new_learnings": [{"insight": "Test learning"}],
            "rationale": "Test",
        }
        mock_result.results = [mock_proposal_result]
        mock_map_pipeline.return_value = mock_result

        # httpx.ASGITransport in 0.28 does not fire FastAPI's lifespan, so
        # every bit of state lifespan builds — vector_store, job_store,
        # tracer, LLM clients — has to be pinned by the test. A prior
        # TestClient test may have set them, but standalone runs start cold
        # and bound-to-dead-loop state from earlier tests is worse than no
        # state. Override everything the /ingest path touches, then restore
        # in finally so the next test starts from whatever lifespan last
        # produced (or None, if this was the first test to run).
        from jobs import JobStore

        import api
        mock_store = MagicMock()
        mock_store.index_documents = AsyncMock(return_value=1)
        mock_store.count = AsyncMock(return_value=0)
        mock_store.close = AsyncMock()
        old_store = api.vector_store
        api.vector_store = mock_store

        mock_tracer = MagicMock()
        mock_tracer.flush = AsyncMock()
        mock_tracer.close = AsyncMock()

        old_job_store = getattr(app.state, "job_store", None)
        old_tracer = getattr(app.state, "tracer", None)
        old_query_llm = getattr(app.state, "query_llm", None)
        old_ingest_llm = getattr(app.state, "ingest_llm", None)

        app.state.job_store = JobStore()
        app.state.tracer = mock_tracer
        app.state.query_llm = MagicMock()
        app.state.ingest_llm = MagicMock()

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")

            with open(entry_file, "w") as f:
                yaml.dump({"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"}, f)

            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post("/ingest", json={"file_path": entry_file})
                    assert response.status_code == 202
                    job_id = response.json()["job_id"]

                    for _ in range(50):
                        status = await client.get(f"/jobs/{job_id}")
                        if status.json()["status"] in ("complete", "failed"):
                            break
                        await asyncio.sleep(0.05)

                    result = status.json()
                    assert result["status"] == "complete"
                    assert result["result"]["entry_id"] == "test-entry"
                    assert len(result["result"]["proposals"]) == 1
                    assert result["result"]["proposals"][0]["target_summary_id"] == "summary-1"
                    assert result["progress_detail"] is None  # cleared on completion
            finally:
                api.CONTENT_DIR = old_content_dir
                api.vector_store = old_store
                app.state.job_store = old_job_store
                app.state.tracer = old_tracer
                app.state.query_llm = old_query_llm
                app.state.ingest_llm = old_ingest_llm


class TestEntriesWithLastIngested:
    """Tests for the /entries endpoint with last_ingested field."""

    def test_entries_includes_last_ingested(self):
        from fastapi.testclient import TestClient
        from api import app
        import api

        with TestClient(app) as client:
            api.entries_cache["test-with-date"] = {
                "id": "test-with-date",
                "content": "Test content",
                "metadata": {"type": "entry", "topic": "Test", "status": "active",
                             "file_path": "/test/path.yaml", "last_ingested": "2024-01-15"},
                "raw": {"id": "test-with-date", "last_ingested": "2024-01-15"},
            }
            api.entries_cache["test-without-date"] = {
                "id": "test-without-date",
                "content": "Test content",
                "metadata": {"type": "entry", "topic": "Test", "status": "active",
                             "file_path": "/test/path2.yaml"},
                "raw": {"id": "test-without-date"},
            }

            try:
                response = client.get("/entries")
                assert response.status_code == 200
                data = response.json()
                entries_by_id = {e["id"]: e for e in data["entries"]}
                assert entries_by_id["test-with-date"]["last_ingested"] == "2024-01-15"
                assert entries_by_id["test-without-date"]["last_ingested"] is None
            finally:
                api.entries_cache.pop("test-with-date", None)
                api.entries_cache.pop("test-without-date", None)


class TestApproveEndpoint:
    """Tests for the /approve endpoint."""

    @patch("api.apply_update")
    @patch("api.load_content")
    @patch("api.VectorStore")
    def test_approve_success(self, MockVectorStore, mock_load, mock_apply):
        from fastapi.testclient import TestClient
        from api import app

        mock_store = MagicMock()
        mock_store.index_documents = AsyncMock(return_value=1)
        mock_store.count = AsyncMock(return_value=0)
        mock_store.close = AsyncMock()
        MockVectorStore.return_value = mock_store

        mock_apply.return_value = {"success": True, "file": "/path/to/file.yaml", "changes": ["Added learning"]}
        mock_load.return_value = []

        with TestClient(app) as client:
            response = client.post("/approve", json={
                "proposal": {
                    "target_summary_id": "test-summary",
                    "source_entry_id": "test-entry",
                    "new_learnings": [{"insight": "Test", "context": "Test"}],
                }
            })
            assert response.status_code == 200
            assert response.json()["success"] is True

    @patch("api.apply_update")
    def test_approve_failure(self, mock_apply):
        from fastapi.testclient import TestClient
        from api import app

        mock_apply.return_value = {"success": False, "error": "File not found"}

        with TestClient(app) as client:
            response = client.post("/approve", json={
                "proposal": {"target_summary_id": "nonexistent", "source_entry_id": "test-entry"}
            })
            assert response.status_code == 200
            assert response.json()["success"] is False


class TestChangelogEndpoint:
    """Tests for the /changelog endpoint."""

    def test_changelog_returns_changes(self):
        from fastapi.testclient import TestClient
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
                    {"timestamp": "2024-01-15T12:00:00Z", "type": "added", "path": "test.field", "source": "test.yaml"},
                    {"timestamp": "2024-01-15T13:00:00Z", "type": "modified", "path": "test.other", "source": "test.yaml"},
                ])

                try:
                    response = client.get("/changelog")
                    assert response.status_code == 200
                    data = response.json()
                    assert len(data["changes"]) == 2
                    assert data["total"] == 2
                finally:
                    api.changelog = old_changelog

    def test_changelog_filter_by_type(self):
        from fastapi.testclient import TestClient
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
                    assert len(response.json()["changes"]) == 2
                finally:
                    api.changelog = old_changelog

    def test_changelog_invalid_change_type(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.get("/changelog?change_type=invalid")
            assert response.status_code == 400


class TestChangelogSourcesEndpoint:
    def test_changelog_sources_returns_unique_sources(self):
        from fastapi.testclient import TestClient
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
                api.changelog.append([
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "a.yaml", "path": "x"},
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "b.yaml", "path": "y"},
                    {"timestamp": "2024-01-15T12:00:00Z", "source": "a.yaml", "path": "z"},
                ])

                try:
                    response = client.get("/changelog/sources")
                    assert response.status_code == 200
                    assert sorted(response.json()["sources"]) == ["a.yaml", "b.yaml"]
                finally:
                    api.changelog = old_changelog


class TestChangelogStatsEndpoint:
    def test_changelog_stats_returns_statistics(self):
        from fastapi.testclient import TestClient
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
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
                finally:
                    api.changelog = old_changelog


class TestEntryHistoryEndpoint:
    def test_entry_history_returns_changes(self):
        from fastapi.testclient import TestClient
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
                api.entries_cache["test-entry"] = {
                    "id": "test-entry", "content": "Test",
                    "metadata": {"type": "entry", "file_path": "entries/test-entry.yaml"},
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
                    assert len(data["changes"]) == 2
                    assert data["total"] == 2
                finally:
                    api.changelog = old_changelog
                    api.entries_cache.pop("test-entry", None)

    def test_entry_history_respects_limit(self):
        """Should respect the limit parameter."""
        from fastapi.testclient import TestClient
        from api import app
        import api
        from diff_engine import Changelog
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            with TestClient(app) as client:
                old_changelog = api.changelog
                api.changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
                api.entries_cache["test-entry"] = {
                    "id": "test-entry", "content": "Test",
                    "metadata": {"type": "entry", "file_path": "entries/test-entry.yaml"},
                }
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
                    assert data["total"] == 10
                finally:
                    api.changelog = old_changelog
                    api.entries_cache.pop("test-entry", None)
