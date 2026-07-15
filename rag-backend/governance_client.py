"""
Algerknown RAG - Governance Client

Submits generated RAG candidates to the Node governed HTTP API
(POST /api/governance/processor/proposals) as durable generic proposals.

This module is a propose-only client: it authenticates with a processor
credential, sends source entry id, target summary id, generated fields,
confidence, and processor version -- and nothing that claims reviewer or
evaluator authority. It never writes to the governed SQLite database or the
Algerknown git repository directly; persistence and every subsequent review
action live entirely on the Node side.
"""

import hashlib
import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_GOVERNANCE_API_URL = "http://127.0.0.1:2393/api/governance"


class GovernanceClientError(Exception):
    """Raised when a candidate submission fails or is rejected by the governance API."""

    def __init__(self, status_code: Optional[int], body: Any, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def build_candidate_idempotency_key(job_id: str, candidate_ordinal: int, candidate: dict) -> str:
    """
    Stable per-candidate idempotency key: ingest job id, candidate ordinal,
    and a canonical hash of the candidate's own content. Resubmitting the
    exact same candidate (e.g. a retried job) always produces the same key,
    so the governance API's own idempotency handling recognizes it as the
    same submission instead of creating a duplicate proposal.
    """
    canonical = json.dumps(candidate, sort_keys=True, default=str)
    content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return f"{job_id}:{candidate_ordinal}:{content_hash}"


class GovernanceClient:
    """Propose-only client for the Node governance API's processor ingest endpoint."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        processor_secret: Optional[str] = None,
        processor_version: str = "rag-backend",
        timeout_seconds: float = 30.0,
    ):
        self.base_url = (base_url or os.getenv("GOVERNANCE_API_URL") or DEFAULT_GOVERNANCE_API_URL).rstrip("/")
        self.processor_secret = processor_secret if processor_secret is not None else os.getenv("GOVERNANCE_PROCESSOR_SECRET")
        self.processor_version = processor_version
        self.timeout_seconds = timeout_seconds

    @property
    def enabled(self) -> bool:
        """False when no processor secret is configured -- governance submission is optional per deployment."""
        return bool(self.processor_secret)

    async def submit_candidate(
        self,
        *,
        source_entry_id: str,
        target_summary_id: str,
        confidence: float,
        idempotency_key: str,
        new_learnings: Optional[list[dict]] = None,
        new_decisions: Optional[list[dict]] = None,
        new_open_questions: Optional[list[str]] = None,
        new_links: Optional[list[dict]] = None,
    ) -> dict:
        """
        Submits one candidate. Returns the parsed response body:
        {"proposalId": str, "status": "created" | "suppressed", "reason": str | None}.

        Raises GovernanceClientError on any transport failure or non-2xx
        response -- callers decide whether that makes the candidate
        retryable (see api.py's run_ingest_job).
        """
        if not self.enabled:
            raise GovernanceClientError(None, None, "GOVERNANCE_PROCESSOR_SECRET is not configured")

        payload: dict[str, Any] = {
            "sourceEntryId": source_entry_id,
            "targetSummaryId": target_summary_id,
            "confidence": confidence,
            "processorVersion": self.processor_version,
            "idempotencyKey": idempotency_key,
        }
        if new_learnings:
            payload["newLearnings"] = new_learnings
        if new_decisions:
            payload["newDecisions"] = new_decisions
        if new_open_questions:
            payload["newOpenQuestions"] = new_open_questions
        if new_links:
            payload["newLinks"] = new_links

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    f"{self.base_url}/processor/proposals",
                    json=payload,
                    headers={"Authorization": f"Bearer {self.processor_secret}"},
                )
        except httpx.HTTPError as e:
            raise GovernanceClientError(None, None, f"governance API request failed: {e}") from e

        try:
            body = response.json() if response.content else None
        except ValueError:
            body = None

        if response.status_code not in (200, 201):
            detail = body.get("error") if isinstance(body, dict) else None
            raise GovernanceClientError(
                response.status_code, body, f"governance API returned {response.status_code}" + (f" ({detail})" if detail else "")
            )

        if not isinstance(body, dict):
            raise GovernanceClientError(response.status_code, body, "governance API returned an unexpected response body")

        return body

    async def submit_operation(self, *, subject: str, description: str, idempotency_key: str) -> dict:
        """
        Records one generic, application-neutral append-only operation event
        (POST /processor/operations) -- never reviewable content, unlike
        submit_candidate. Used for ingest completion tracking (last_ingested)
        instead of an ungoverned YAML edit. Returns
        {"status": "recorded", "resultingRevision": int}.

        Raises GovernanceClientError on any transport failure or non-2xx
        response; callers treat this as non-fatal telemetry (see
        api.py's run_ingest_job, which logs and continues rather than
        failing the ingest job over a telemetry write).
        """
        if not self.enabled:
            raise GovernanceClientError(None, None, "GOVERNANCE_PROCESSOR_SECRET is not configured")

        payload = {"subject": subject, "description": description, "idempotencyKey": idempotency_key}

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    f"{self.base_url}/processor/operations",
                    json=payload,
                    headers={"Authorization": f"Bearer {self.processor_secret}"},
                )
        except httpx.HTTPError as e:
            raise GovernanceClientError(None, None, f"governance API request failed: {e}") from e

        try:
            body = response.json() if response.content else None
        except ValueError:
            body = None

        if response.status_code not in (200, 201):
            detail = body.get("error") if isinstance(body, dict) else None
            raise GovernanceClientError(
                response.status_code, body, f"governance API returned {response.status_code}" + (f" ({detail})" if detail else "")
            )

        if not isinstance(body, dict):
            raise GovernanceClientError(response.status_code, body, "governance API returned an unexpected response body")

        return body
