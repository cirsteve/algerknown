"""
Phase 2 governance integration tests for the RAG backend.

Covers the exit-criterion assertions specific to this package: /approve and
/preview are retired (410), writer.py exposes no file-apply function,
generated candidates reach the durable proposal store before the ingest job
is marked complete, JobStore's result carries only ids/counts (never raw
candidate content), and ingest completion is recorded as a generic governed
operation event rather than an ungoverned YAML edit.

No network provider calls: every governance HTTP call in this file is routed
through httpx.MockTransport or a FakeClient, exactly like
test_governance_client.py and test_api.py's existing ingest tests.
"""

import asyncio
import json
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

os.environ.setdefault("CONTENT_DIR", "/tmp/test-content")
os.environ.setdefault("CHROMA_DB_DIR", "/tmp/test-chroma")
os.environ.setdefault("USE_MOCK_EMBEDDINGS", "true")


def write_entry_yaml(path: str, entry: dict) -> None:
    from ruamel.yaml import YAML

    yaml = YAML()
    yaml.preserve_quotes = True
    with open(path, "w") as f:
        yaml.dump(entry, f)


class TestLegacyApplyEndpointsRetired:
    """/approve and /preview never apply a write; writer.py has no apply function to fall back to."""

    def test_approve_returns_410(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/approve", json={"proposal": {"target_summary_id": "s", "source_entry_id": "e"}})
            assert response.status_code == 410
            assert response.json()["error"] == "endpoint_retired"

    def test_preview_returns_410(self):
        from fastapi.testclient import TestClient
        from api import app

        with TestClient(app) as client:
            response = client.post("/preview", json={"proposal": {"target_summary_id": "s", "source_entry_id": "e"}})
            assert response.status_code == 410
            assert response.json()["error"] == "endpoint_retired"

    def test_writer_module_exposes_no_apply_function(self):
        import writer

        assert not hasattr(writer, "apply_update")
        assert not hasattr(writer, "apply_proposal")

    def test_api_module_imports_no_writer_symbol(self):
        import api

        assert not hasattr(api, "writer")


class TestCandidatesPersistBeforeJobCompletion:
    """Generated candidates reach the durable proposal store before the ingest job is marked complete."""

    @pytest.mark.asyncio
    @patch("api.identify_related_summaries")
    @patch("api.map_pipeline")
    async def test_proposal_ids_are_populated_by_the_time_the_job_completes(self, mock_map_pipeline, mock_identify):
        from api import app
        from jobs import JobStore
        from governance_client import GovernanceClient

        mock_identify.return_value = [
            {"id": "summary-1", "content": "S1", "metadata": {}, "score": 0.9, "match_reason": "semantic"},
        ]
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

        submitted = []

        class RecordingClient:
            enabled = True

            async def submit_candidate(self, **kwargs):
                submitted.append(kwargs)
                return {"proposalId": f"proposal-{len(submitted)}", "status": "created"}

            async def submit_operation(self, **kwargs):
                return {"status": "recorded", "resultingRevision": 1}

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
        old_governance_client = getattr(app.state, "governance_client", None)

        app.state.job_store = JobStore()
        app.state.tracer = mock_tracer
        app.state.query_llm = MagicMock()
        app.state.ingest_llm = MagicMock()
        app.state.governance_client = RecordingClient()

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            write_entry_yaml(entry_file, {"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"})

            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
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
                    # The candidate reached the durable proposal store (our
                    # RecordingClient.submit_candidate) before the job was
                    # marked complete -- the mock only ever appends and never
                    # runs concurrently with the assertion above by
                    # construction (run_ingest_job awaits persistence before
                    # updating status), but we also assert the *result*
                    # reflects it directly:
                    assert result["result"]["proposal_ids"] == ["proposal-1"]
                    assert result["result"]["counts"] == {"generated": 1, "persisted": 1, "suppressed": 0}
                    assert len(submitted) == 1
                    assert submitted[0]["source_entry_id"] == "test-entry"
            finally:
                api.CONTENT_DIR = old_content_dir
                api.vector_store = old_store
                app.state.job_store = old_job_store
                app.state.tracer = old_tracer
                app.state.query_llm = old_query_llm
                app.state.ingest_llm = old_ingest_llm
                app.state.governance_client = old_governance_client


class TestJobStoreCarriesOnlyIdsAndCounts:
    """JobStore's ingest result must never hold raw candidate content -- ids and counts only."""

    def test_ingest_result_shape_has_no_raw_candidate_content(self):
        from jobs import JobStore, JobStatus

        store = JobStore()
        job = store.create("ingest")
        store.update(
            job.id,
            status=JobStatus.COMPLETE,
            result={
                "entry_id": "test-entry",
                "proposal_ids": ["p1", "p2"],
                "suppressed": [{"index": 0, "proposalId": "p3", "reason": "dup"}],
                "counts": {"generated": 3, "persisted": 2, "suppressed": 1},
            },
        )
        stored = store.get(job.id)
        assert set(stored.result.keys()) <= {"entry_id", "proposal_ids", "suppressed", "counts", "retryable_idempotency_keys"}
        # No raw candidate fields (insight text, learnings, decisions) ever appear.
        serialized = json.dumps(stored.result)
        for forbidden in ("insight", "new_learnings", "new_decisions", "rationale"):
            assert forbidden not in serialized


class TestIngestRecordsOperationNotYamlEdit:
    """Ingest completion is a generic governed operation event, never a last_ingested YAML edit."""

    @pytest.mark.asyncio
    @patch("api.identify_related_summaries")
    async def test_ingest_calls_submit_operation_and_never_writes_last_ingested_to_disk(self, mock_identify):
        from api import app
        from jobs import JobStore

        mock_identify.return_value = []

        operation_calls = []

        class RecordingClient:
            enabled = True

            async def submit_operation(self, **kwargs):
                operation_calls.append(kwargs)
                return {"status": "recorded", "resultingRevision": 1}

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
        old_governance_client = getattr(app.state, "governance_client", None)

        app.state.job_store = JobStore()
        app.state.tracer = mock_tracer
        app.state.query_llm = MagicMock()
        app.state.ingest_llm = MagicMock()
        app.state.governance_client = RecordingClient()

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            write_entry_yaml(entry_file, {"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"})
            before_bytes = open(entry_file, "rb").read()

            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.post("/ingest", json={"file_path": entry_file})
                    job_id = response.json()["job_id"]

                    for _ in range(50):
                        status = await client.get(f"/jobs/{job_id}")
                        if status.json()["status"] in ("complete", "failed"):
                            break
                        await asyncio.sleep(0.05)

                    assert status.json()["status"] == "complete"
                    assert len(operation_calls) == 1
                    assert operation_calls[0]["subject"] == "algerknown.entry:test-entry:ingest"
                    assert "idempotency_key" in operation_calls[0]

                    # The entry file on disk is byte-identical -- no
                    # last_ingested (or any other) field was written back.
                    after_bytes = open(entry_file, "rb").read()
                    assert after_bytes == before_bytes
                    assert b"last_ingested" not in after_bytes
            finally:
                api.CONTENT_DIR = old_content_dir
                api.vector_store = old_store
                app.state.job_store = old_job_store
                app.state.tracer = old_tracer
                app.state.query_llm = old_query_llm
                app.state.ingest_llm = old_ingest_llm
                app.state.governance_client = old_governance_client

    @pytest.mark.asyncio
    async def test_submit_operation_failure_is_non_fatal_to_the_ingest_job(self, monkeypatch):
        """A governance telemetry failure must not fail the ingest job itself -- the
        candidate proposals are the job's deliverable, not the operation event."""
        from api import app
        from jobs import JobStore
        from governance_client import GovernanceClientError

        monkeypatch.setattr("api.identify_related_summaries", AsyncMock(return_value=[]))

        class FailingClient:
            enabled = True

            async def submit_operation(self, **kwargs):
                raise GovernanceClientError(500, None, "boom")

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
        old_governance_client = getattr(app.state, "governance_client", None)

        app.state.job_store = JobStore()
        app.state.tracer = mock_tracer
        app.state.query_llm = MagicMock()
        app.state.ingest_llm = MagicMock()
        app.state.governance_client = FailingClient()

        with tempfile.TemporaryDirectory() as tmpdir:
            entries_dir = os.path.join(tmpdir, "entries")
            os.makedirs(entries_dir)
            entry_file = os.path.join(entries_dir, "test-entry.yaml")
            write_entry_yaml(entry_file, {"id": "test-entry", "type": "entry", "topic": "Test", "content": "Test"})

            old_content_dir = api.CONTENT_DIR
            api.CONTENT_DIR = tmpdir
            api.entries_cache.clear()

            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.post("/ingest", json={"file_path": entry_file})
                    job_id = response.json()["job_id"]

                    for _ in range(50):
                        status = await client.get(f"/jobs/{job_id}")
                        if status.json()["status"] in ("complete", "failed"):
                            break
                        await asyncio.sleep(0.05)

                    # Still completes despite the operation-event failure.
                    assert status.json()["status"] == "complete"
            finally:
                api.CONTENT_DIR = old_content_dir
                api.vector_store = old_store
                app.state.job_store = old_job_store
                app.state.tracer = old_tracer
                app.state.query_llm = old_query_llm
                app.state.ingest_llm = old_ingest_llm
                app.state.governance_client = old_governance_client


class TestSubmitOperationTransport:
    """GovernanceClient.submit_operation's own request shape, mirroring test_governance_client.py's submit_candidate coverage."""

    @pytest.mark.asyncio
    async def test_submits_expected_payload_and_auth_header(self):
        from governance_client import GovernanceClient

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
            return httpx.Response(201, json={"status": "recorded", "resultingRevision": 1})

        real_async_client = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs.pop("transport", None)
            return real_async_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        client = GovernanceClient(processor_secret="s3cr3t")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(httpx, "AsyncClient", factory)
            result = await client.submit_operation(subject="algerknown.entry:e1:ingest", description="Ingested e1", idempotency_key="ingest:job-1:e1")

        assert result == {"status": "recorded", "resultingRevision": 1}
        assert captured["auth"] == "Bearer s3cr3t"
        assert captured["body"] == {
            "subject": "algerknown.entry:e1:ingest",
            "description": "Ingested e1",
            "idempotencyKey": "ingest:job-1:e1",
        }
        assert captured["url"].endswith("/processor/operations")

    @pytest.mark.asyncio
    async def test_disabled_client_raises(self):
        from governance_client import GovernanceClient, GovernanceClientError

        client = GovernanceClient(processor_secret="")
        with pytest.raises(GovernanceClientError):
            await client.submit_operation(subject="s", description="d", idempotency_key="k")
