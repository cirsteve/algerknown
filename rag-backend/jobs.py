"""
Algerknown RAG - Job Store

In-memory job tracking for async operations.
Jobs are ephemeral (TTL-cleaned) — not designed to survive restarts.
"""

import asyncio
import time
import uuid
import logging
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class Job:
    id: str
    type: str  # "query" | "ingest"
    status: JobStatus
    created_at: float
    updated_at: float
    progress: str = "Pending"
    progress_detail: dict | None = None
    result: dict | None = None
    error: str | None = None
    trace_id: str | None = None
    _task: asyncio.Task | None = field(default=None, repr=False)


class JobStore:
    """In-memory job store with TTL-based cleanup."""

    def __init__(self, ttl_seconds: int = 3600):
        self._jobs: dict[str, Job] = {}
        self._ttl = ttl_seconds

    def create(self, job_type: str) -> Job:
        """Create a new pending job. Runs opportunistic cleanup."""
        self.cleanup()

        now = time.time()
        job = Job(
            id=uuid.uuid4().hex,
            type=job_type,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )
        self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        """Get a job by ID, or None if not found."""
        return self._jobs.get(job_id)

    _MUTABLE_FIELDS = {"status", "progress", "progress_detail", "result", "error", "trace_id", "_task"}

    def update(self, job_id: str, **kwargs) -> None:
        """Update mutable job fields. Automatically sets updated_at."""
        job = self._jobs.get(job_id)
        if job is None:
            logger.warning(f"Attempted to update non-existent job: {job_id}")
            return

        for key, value in kwargs.items():
            if key in self._MUTABLE_FIELDS:
                setattr(job, key, value)
            else:
                logger.warning(f"Cannot update immutable or unknown job field: {key}")

        job.updated_at = time.time()

    def cleanup(self) -> int:
        """Remove terminal jobs older than TTL. Skips pending/running jobs."""
        cutoff = time.time() - self._ttl
        expired = [
            jid for jid, job in self._jobs.items()
            if job.updated_at < cutoff
            and job.status in (JobStatus.COMPLETE, JobStatus.FAILED)
        ]
        for jid in expired:
            del self._jobs[jid]
        if expired:
            logger.info(f"Cleaned up {len(expired)} expired jobs")
        return len(expired)

    def list_all(self, status: JobStatus | None = None, limit: int = 50) -> list[Job]:
        """List all jobs, optionally filtered by status, sorted by created_at desc."""
        jobs = list(self._jobs.values())
        if status is not None:
            jobs = [j for j in jobs if j.status == status]
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return jobs[:limit]

    def to_dict(self, job: Job) -> dict:
        """Serialize a job for API response. Excludes internal fields."""
        return {
            "job_id": job.id,
            "type": job.type,
            "status": job.status.value,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "progress": job.progress,
            "progress_detail": job.progress_detail,
            "result": job.result,
            "error": job.error,
            "trace_id": job.trace_id,
        }
