"""Tests for the proposer module.

Covers:
- identify_related_summaries ranks candidates using explicit links, semantic,
  and tag/topic overlap.
- propose_updates converts run_agent output into the proposal dict shape.
- generate_all_proposals filters no_updates / errors.

Uses the mock embedder so tests run without a network; LLM calls are mocked
by substituting a scripted LLMClient via monkey-patching ``from_model``.
"""

from __future__ import annotations

import json

import pytest
from jig.core.types import CompletionParams, LLMClient, LLMResponse, ToolCall, Usage

import proposer
from memory_store import build_memory, index_documents, mock_embedder


@pytest.fixture
async def memory(tmp_path):
    store, retriever = await build_memory(
        db_path=str(tmp_path / "mem.db"), embedder=mock_embedder()
    )
    yield store, retriever
    await store.close()


@pytest.fixture
def sample_entry():
    return {
        "id": "entry-nullifiers-2026",
        "content": "Explored nullifier construction using Poseidon hash.",
        "metadata": {
            "type": "entry",
            "topic": "Nullifiers",
            "tags": "zk,privacy,nullifiers",
        },
        "raw": {
            "id": "entry-nullifiers-2026",
            "links": [{"id": "summary-nullifiers", "relationship": "informs"}],
        },
    }


@pytest.fixture
def three_summaries():
    return [
        {
            "id": "summary-nullifiers",
            "content": "Summary of nullifier patterns",
            "metadata": {"type": "summary", "topic": "Nullifiers", "tags": "zk,nullifiers"},
        },
        {
            "id": "summary-zkml",
            "content": "Summary of ZKML approaches",
            "metadata": {"type": "summary", "topic": "ZKML", "tags": "zk,ml"},
        },
        {
            "id": "summary-privacy",
            "content": "Summary of privacy techniques",
            "metadata": {"type": "summary", "topic": "Privacy", "tags": "privacy"},
        },
    ]


# --- Scripted LLM plumbing for agent tests --------------------------------


class ScriptedLLMClient(LLMClient):
    def __init__(self, responses: list[LLMResponse]) -> None:
        self._responses = list(responses)

    async def complete(self, params: CompletionParams) -> LLMResponse:
        if not self._responses:
            raise RuntimeError("ScriptedLLMClient exhausted")
        return self._responses.pop(0)


def _submit_output(args: dict) -> LLMResponse:
    return LLMResponse(
        content="",
        tool_calls=[ToolCall(id="c1", name="submit_output", arguments=args)],
        usage=Usage(input_tokens=1, output_tokens=1, cost=0.0),
        latency_ms=1.0,
        model="scripted",
    )


@pytest.fixture
def patch_from_model(monkeypatch):
    """Replace proposer.from_model with a factory returning a scripted client."""

    def _apply(llm: LLMClient):
        monkeypatch.setattr(proposer, "from_model", lambda _model: llm)

    return _apply


# --- identify_related_summaries -------------------------------------------


async def test_explicit_link_ranks_highest(memory, sample_entry, three_summaries):
    store, retriever = memory
    await index_documents(store, three_summaries)

    related = await proposer.identify_related_summaries(
        sample_entry, store, retriever, max_results=3
    )

    assert related[0]["id"] == "summary-nullifiers"
    assert related[0]["score"] >= 1.0
    assert "explicit_link" in related[0]["match_reason"]


async def test_no_summaries_returns_empty(memory, sample_entry):
    store, retriever = memory
    assert (
        await proposer.identify_related_summaries(sample_entry, store, retriever) == []
    )


async def test_tag_overlap_boosts_score(memory, three_summaries):
    store, retriever = memory
    await index_documents(store, three_summaries)

    entry_no_links = {
        "id": "entry-privacy-2026",
        "content": "Privacy notes",
        "metadata": {"type": "entry", "topic": "Privacy", "tags": "privacy,zk"},
        "raw": {"id": "entry-privacy-2026", "links": []},
    }

    related = await proposer.identify_related_summaries(
        entry_no_links, store, retriever, max_results=3
    )

    privacy = next(r for r in related if r["id"] == "summary-privacy")
    # Topic match (+0.3) + 1 shared tag (+0.1) — baseline semantic or fresh tag_overlap
    assert privacy["score"] >= 0.3


# --- propose_updates ------------------------------------------------------


async def test_propose_updates_happy_path(patch_from_model, sample_entry, three_summaries):
    summary = three_summaries[0]
    proposal_args = {
        "new_learnings": [
            {
                "insight": "Poseidon is efficient for nullifiers",
                "context": "The entry shows a working construction.",
                "relevance": [sample_entry["id"]],
            }
        ],
        "new_decisions": [],
        "new_open_questions": [],
        "new_links": [
            {
                "id": sample_entry["id"],
                "relationship": "informs",
                "notes": "Nullifier construction details",
            }
        ],
        "rationale": "Documents a concrete approach.",
        "no_updates": False,
    }
    patch_from_model(ScriptedLLMClient([_submit_output(proposal_args)]))

    proposal = await proposer.propose_updates(sample_entry, summary)

    assert proposal["target_summary_id"] == summary["id"]
    assert proposal["source_entry_id"] == sample_entry["id"]
    assert proposal["rationale"] == "Documents a concrete approach."
    assert proposal["new_learnings"][0]["insight"].startswith("Poseidon")
    assert proposal.get("error") is None


async def test_propose_updates_no_updates_flag(patch_from_model, sample_entry, three_summaries):
    summary = three_summaries[1]  # unrelated
    patch_from_model(
        ScriptedLLMClient([_submit_output({"no_updates": True, "rationale": "unrelated"})])
    )

    proposal = await proposer.propose_updates(sample_entry, summary)

    assert proposal["no_updates"] is True
    assert proposal["rationale"] == "unrelated"


async def test_propose_updates_surfaces_llm_error(
    patch_from_model, sample_entry, three_summaries
):
    class ExplodingLLM(LLMClient):
        async def complete(self, params: CompletionParams) -> LLMResponse:
            raise RuntimeError("anthropic 500")

    patch_from_model(ExplodingLLM())

    proposal = await proposer.propose_updates(sample_entry, three_summaries[0])

    assert proposal.get("error")


# --- generate_all_proposals -----------------------------------------------


async def test_generate_all_proposals_skips_no_updates(
    patch_from_model, memory, sample_entry, three_summaries
):
    store, retriever = memory
    await index_documents(store, three_summaries)

    patch_from_model(
        ScriptedLLMClient(
            [
                _submit_output(
                    {
                        "new_learnings": [
                            {"insight": "nullifier construction", "relevance": []}
                        ],
                        "rationale": "direct fit",
                        "no_updates": False,
                    }
                ),
                _submit_output({"no_updates": True, "rationale": "off-topic"}),
                _submit_output({"no_updates": True, "rationale": "off-topic"}),
            ]
        )
    )

    proposals = await proposer.generate_all_proposals(
        sample_entry, store, retriever, max_proposals=3
    )

    assert len(proposals) == 1
    assert proposals[0]["rationale"] == "direct fit"


# Keep `json` import in use.
_ = json
