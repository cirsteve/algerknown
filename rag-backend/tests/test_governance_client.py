"""
Tests for the governance_client module.
"""

import json

import httpx
import pytest

from governance_client import (
    GovernanceClient,
    GovernanceClientError,
    build_candidate_idempotency_key,
)

_REAL_ASYNC_CLIENT = httpx.AsyncClient


def mock_transport_async_client(handler):
    """A stand-in for httpx.AsyncClient that always routes through a MockTransport,
    built from the real class captured before any monkeypatching."""

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return _REAL_ASYNC_CLIENT(*args, transport=httpx.MockTransport(handler), **kwargs)

    return factory


class TestBuildCandidateIdempotencyKey:
    def test_stable_for_identical_candidate(self):
        candidate = {"source_entry_id": "e1", "target_summary_id": "s1", "new_learnings": [{"insight": "x"}]}
        key1 = build_candidate_idempotency_key("job-1", 0, candidate)
        key2 = build_candidate_idempotency_key("job-1", 0, candidate)
        assert key1 == key2

    def test_differs_by_job_id(self):
        candidate = {"source_entry_id": "e1", "target_summary_id": "s1"}
        assert build_candidate_idempotency_key("job-1", 0, candidate) != build_candidate_idempotency_key("job-2", 0, candidate)

    def test_differs_by_ordinal(self):
        candidate = {"source_entry_id": "e1", "target_summary_id": "s1"}
        assert build_candidate_idempotency_key("job-1", 0, candidate) != build_candidate_idempotency_key("job-1", 1, candidate)

    def test_differs_by_content(self):
        c1 = {"source_entry_id": "e1", "target_summary_id": "s1", "new_learnings": [{"insight": "x"}]}
        c2 = {"source_entry_id": "e1", "target_summary_id": "s1", "new_learnings": [{"insight": "y"}]}
        assert build_candidate_idempotency_key("job-1", 0, c1) != build_candidate_idempotency_key("job-1", 0, c2)

    def test_stable_regardless_of_key_order(self):
        c1 = {"a": 1, "b": 2}
        c2 = {"b": 2, "a": 1}
        assert build_candidate_idempotency_key("job-1", 0, c1) == build_candidate_idempotency_key("job-1", 0, c2)


class TestGovernanceClientEnabled:
    def test_disabled_without_secret(self):
        client = GovernanceClient(processor_secret="")
        assert client.enabled is False

    def test_enabled_with_secret(self):
        client = GovernanceClient(processor_secret="s3cr3t")
        assert client.enabled is True

    @pytest.mark.asyncio
    async def test_disabled_client_raises_on_submit(self):
        client = GovernanceClient(processor_secret="")
        with pytest.raises(GovernanceClientError):
            await client.submit_candidate(source_entry_id="e1", target_summary_id="s1", confidence=0.5, idempotency_key="k1")


@pytest.mark.asyncio
class TestSubmitCandidate:
    async def test_submits_expected_payload_and_auth_header(self, monkeypatch):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
            return httpx.Response(201, json={"proposalId": "p1", "status": "created"})

        monkeypatch.setattr(httpx, "AsyncClient", mock_transport_async_client(handler))

        client = GovernanceClient(base_url="http://test-governance/api/governance", processor_secret="proc-secret", processor_version="1.2.3")
        result = await client.submit_candidate(
            source_entry_id="entry-1",
            target_summary_id="summary-1",
            confidence=0.75,
            idempotency_key="job-1:0:hash",
            new_learnings=[{"insight": "x"}],
        )

        assert result == {"proposalId": "p1", "status": "created"}
        assert captured["url"] == "http://test-governance/api/governance/processor/proposals"
        assert captured["auth"] == "Bearer proc-secret"
        assert captured["body"] == {
            "sourceEntryId": "entry-1",
            "targetSummaryId": "summary-1",
            "confidence": 0.75,
            "processorVersion": "1.2.3",
            "idempotencyKey": "job-1:0:hash",
            "newLearnings": [{"insight": "x"}],
        }

    async def test_raises_governance_client_error_on_4xx(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": "source_entry_not_found"})

        monkeypatch.setattr(httpx, "AsyncClient", mock_transport_async_client(handler))

        client = GovernanceClient(base_url="http://test-governance/api/governance", processor_secret="proc-secret")
        with pytest.raises(GovernanceClientError) as exc_info:
            await client.submit_candidate(source_entry_id="missing", target_summary_id="s1", confidence=0.5, idempotency_key="k1")

        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {"error": "source_entry_not_found"}

    async def test_suppressed_outcome_is_returned_not_raised(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"proposalId": "p-old", "status": "suppressed", "reason": "duplicate"})

        monkeypatch.setattr(httpx, "AsyncClient", mock_transport_async_client(handler))

        client = GovernanceClient(base_url="http://test-governance/api/governance", processor_secret="proc-secret")
        result = await client.submit_candidate(source_entry_id="e1", target_summary_id="s1", confidence=0.5, idempotency_key="k1")

        assert result["status"] == "suppressed"
        assert result["proposalId"] == "p-old"
