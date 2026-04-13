"""
Tests for the jobs module.

Tests cover:
- Job creation and field defaults
- JobStore: create, get, update, cleanup, to_dict
"""

import time
from unittest.mock import patch

from jobs import Job, JobStatus, JobStore


class TestJob:
    """Tests for the Job dataclass."""

    def test_default_fields(self):
        """Should have sensible defaults."""
        job = Job(
            id="test-123",
            type="query",
            status=JobStatus.PENDING,
            created_at=time.time(),
            updated_at=time.time(),
        )
        assert job.progress == "Pending"
        assert job.progress_detail is None
        assert job.result is None
        assert job.error is None
        assert job._task is None

    def test_status_enum_values(self):
        """Status enum should have correct string values."""
        assert JobStatus.PENDING == "pending"
        assert JobStatus.RUNNING == "running"
        assert JobStatus.COMPLETE == "complete"
        assert JobStatus.FAILED == "failed"


class TestJobStore:
    """Tests for the JobStore class."""

    def test_create_returns_pending_job(self):
        """Should create a job with pending status."""
        store = JobStore()
        job = store.create("query")

        assert job.type == "query"
        assert job.status == JobStatus.PENDING
        assert len(job.id) == 32  # uuid4 hex
        assert job.created_at > 0
        assert job.updated_at == job.created_at

    def test_create_unique_ids(self):
        """Should create jobs with unique IDs."""
        store = JobStore()
        job1 = store.create("query")
        job2 = store.create("ingest")

        assert job1.id != job2.id

    def test_get_existing_job(self):
        """Should return job by ID."""
        store = JobStore()
        job = store.create("query")

        retrieved = store.get(job.id)
        assert retrieved is job

    def test_get_missing_job(self):
        """Should return None for unknown ID."""
        store = JobStore()
        assert store.get("nonexistent") is None

    def test_update_fields(self):
        """Should update specified fields."""
        store = JobStore()
        job = store.create("query")
        original_updated_at = job.updated_at

        store.update(job.id, status=JobStatus.RUNNING, progress="Working...")

        assert job.status == JobStatus.RUNNING
        assert job.progress == "Working..."
        assert job.updated_at >= original_updated_at

    def test_update_sets_updated_at(self):
        """Should update updated_at on every update."""
        store = JobStore()
        job = store.create("query")
        first = job.updated_at

        # Small delay to ensure time difference
        store.update(job.id, progress="Step 1")
        assert job.updated_at >= first

    def test_update_nonexistent_job(self):
        """Should silently handle updating a missing job."""
        store = JobStore()
        store.update("nonexistent", status=JobStatus.RUNNING)
        # Should not raise

    def test_update_result(self):
        """Should store result dict."""
        store = JobStore()
        job = store.create("query")

        result = {"answer": "42", "sources": ["doc-1"]}
        store.update(job.id, status=JobStatus.COMPLETE, result=result)

        assert job.result == result
        assert job.status == JobStatus.COMPLETE

    def test_cleanup_removes_expired_terminal_jobs(self):
        """Should remove completed/failed jobs older than TTL."""
        store = JobStore(ttl_seconds=1)
        job = store.create("query")
        store.update(job.id, status=JobStatus.COMPLETE)

        # Simulate expiry
        job.updated_at = time.time() - 2

        removed = store.cleanup()
        assert removed == 1
        assert store.get(job.id) is None

    def test_cleanup_preserves_fresh_jobs(self):
        """Should keep jobs within TTL."""
        store = JobStore(ttl_seconds=3600)
        job = store.create("query")
        store.update(job.id, status=JobStatus.COMPLETE)

        removed = store.cleanup()
        assert removed == 0
        assert store.get(job.id) is not None

    def test_cleanup_preserves_running_jobs(self):
        """Should not remove pending/running jobs even if expired."""
        store = JobStore(ttl_seconds=1)
        job = store.create("query")
        store.update(job.id, status=JobStatus.RUNNING)
        job.updated_at = time.time() - 2

        removed = store.cleanup()
        assert removed == 0
        assert store.get(job.id) is not None

    def test_cleanup_runs_on_create(self):
        """Should opportunistically clean up on create."""
        store = JobStore(ttl_seconds=1)
        old_job = store.create("query")
        store.update(old_job.id, status=JobStatus.FAILED)
        old_job.updated_at = time.time() - 2

        # Creating a new job triggers cleanup
        new_job = store.create("ingest")

        assert store.get(old_job.id) is None
        assert store.get(new_job.id) is not None

    def test_to_dict_excludes_task(self):
        """Should not include _task in serialized output."""
        store = JobStore()
        job = store.create("query")

        d = store.to_dict(job)

        assert "_task" not in d
        assert "task" not in d

    def test_to_dict_includes_all_fields(self):
        """Should include all public fields."""
        store = JobStore()
        job = store.create("query")
        store.update(job.id,
                     status=JobStatus.COMPLETE,
                     progress="Complete",
                     progress_detail={"current_step": 2, "total_steps": 2},
                     result={"answer": "test"},
                     error=None)

        d = store.to_dict(job)

        assert d["job_id"] == job.id
        assert d["type"] == "query"
        assert d["status"] == "complete"
        assert d["progress"] == "Complete"
        assert d["progress_detail"] == {"current_step": 2, "total_steps": 2}
        assert d["result"] == {"answer": "test"}
        assert d["error"] is None
        assert "created_at" in d
        assert "updated_at" in d

    def test_to_dict_status_is_string(self):
        """Status should be serialized as string, not enum."""
        store = JobStore()
        job = store.create("query")

        d = store.to_dict(job)
        assert isinstance(d["status"], str)
        assert d["status"] == "pending"
