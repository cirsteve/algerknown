"""Tests for the synthesizer module.

Uses a scripted LLMClient injected via monkey-patched ``from_model`` so
tests exercise the full run_agent path without network calls.
"""

from __future__ import annotations

import pytest
from jig.core.types import CompletionParams, LLMClient, LLMResponse, ToolCall, Usage

import synthesizer


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
    def _apply(llm: LLMClient):
        monkeypatch.setattr(synthesizer, "from_model", lambda _model: llm)

    return _apply


@pytest.fixture
def retrieved_entries():
    return [
        {
            "id": "zksnarks",
            "content": "zk-SNARKs use a trusted setup to produce succinct proofs.",
            "metadata": {"type": "summary", "topic": "ZK Proofs"},
        },
        {
            "id": "nullifiers",
            "content": "Nullifiers prevent double-spending in anonymous systems.",
            "metadata": {"type": "entry", "topic": "Nullifiers"},
        },
    ]


async def test_synthesize_returns_answer_and_sources(patch_from_model, retrieved_entries):
    patch_from_model(
        ScriptedLLMClient(
            [
                _submit_output(
                    {
                        "answer": "zk-SNARKs rely on a trusted setup [zksnarks].",
                        "cited_document_ids": ["zksnarks"],
                    }
                )
            ]
        )
    )

    result = await synthesizer.synthesize_answer("What are zk-SNARKs?", retrieved_entries)

    assert "trusted setup" in result["answer"]
    assert result["sources"] == ["zksnarks"]
    assert result.get("error") is None


async def test_synthesize_falls_back_to_context_ids_when_not_cited(
    patch_from_model, retrieved_entries
):
    patch_from_model(
        ScriptedLLMClient(
            [_submit_output({"answer": "Nothing cited.", "cited_document_ids": []})]
        )
    )

    result = await synthesizer.synthesize_answer("query", retrieved_entries)

    assert result["sources"] == ["zksnarks", "nullifiers"]


async def test_synthesize_truncates_context_under_char_budget(
    patch_from_model, retrieved_entries
):
    big_entries = retrieved_entries + [
        {
            "id": f"big-{i}",
            "content": "X" * 50000,
            "metadata": {"type": "entry", "topic": "big"},
        }
        for i in range(20)
    ]

    patch_from_model(
        ScriptedLLMClient(
            [_submit_output({"answer": "partial", "cited_document_ids": ["zksnarks"]})]
        )
    )

    result = await synthesizer.synthesize_answer(
        "q", big_entries, max_context_tokens=4000
    )

    # Truncation doesn't error — we still get an answer + sources
    assert result["answer"] == "partial"
    assert result["sources"] == ["zksnarks"]


async def test_synthesize_surfaces_llm_error(patch_from_model, retrieved_entries):
    class ExplodingLLM(LLMClient):
        async def complete(self, params: CompletionParams) -> LLMResponse:
            raise RuntimeError("boom")

    patch_from_model(ExplodingLLM())

    result = await synthesizer.synthesize_answer("q", retrieved_entries)

    assert result["sources"] == []
    assert result.get("error")


async def test_synthesize_empty_entries_returns_agent_answer(patch_from_model):
    patch_from_model(
        ScriptedLLMClient(
            [
                _submit_output(
                    {
                        "answer": "No documents retrieved.",
                        "cited_document_ids": [],
                    }
                )
            ]
        )
    )

    result = await synthesizer.synthesize_answer("q", [])

    assert result["answer"] == "No documents retrieved."
    assert result["sources"] == []
