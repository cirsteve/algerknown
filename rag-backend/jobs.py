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

    def update(self, job_id: str, **kwargs) -> None:
        """Update job fields. Automatically sets updated_at."""
        job = self._jobs.get(job_id)
        if job is None:
            logger.warning(f"Attempted to update non-existent job: {job_id}")
            return

        for key, value in kwargs.items():
            if hasattr(job, key):
                setattr(job, key, value)
            else:
                logger.warning(f"Unknown job field: {key}")

        job.updated_at = time.time()

    def cleanup(self) -> int:
        """Remove jobs older than TTL. Returns count removed."""
        cutoff = time.time() - self._ttl
        expired = [jid for jid, job in self._jobs.items() if job.updated_at < cutoff]
        for jid in expired:
            del self._jobs[jid]
        if expired:
            logger.info(f"Cleaned up {len(expired)} expired jobs")
        return len(expired)

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
        }
