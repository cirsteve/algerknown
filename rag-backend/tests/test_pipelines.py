"""
Tests for the pipelines module.

Tests cover:
- retrieve_step: vector store query delegation
- synthesize_step: prompt building, LLM call, response formatting
- propose_step: prompt building, LLM call, JSON parsing
- Query pipeline: end-to-end with mocks
- Proposal map_pipeline: fan-out over multiple summaries
"""

import pytest
import json
from unittest.mock import MagicMock

from jig import run_pipeline, map_pipeline, PipelineResult
from jig.tracing import StdoutTracer
from jig.core.errors import JigLLMError

from helpers import MockLLMClient, make_llm_response


class TestRetrieveStep:
    """Tests for the retrieve_step function."""

    @pytest.mark.asyncio
    async def test_calls_vector_store_query(self):
        """Should call vector_store.query with correct args."""
        from pipelines import retrieve_step

        mock_store = MagicMock()
        mock_store.query.return_value = [
            {"id": "doc-1", "content": "Test", "metadata": {}, "distance": 0.1}
        ]

        ctx = {
            "input": {"query": "What are nullifiers?", "n_results": 5},
            "vector_store": mock_store,
        }

        result = await retrieve_step(ctx)

        mock_store.query.assert_called_once_with("What are nullifiers?", 5)
        assert len(result) == 1
        assert result[0]["id"] == "doc-1"

    @pytest.mark.asyncio
    async def test_defaults_n_results_to_5(self):
        """Should default n_results to 5 if not specified."""
        from pipelines import retrieve_step

        mock_store = MagicMock()
        mock_store.query.return_value = []

        ctx = {
            "input": {"query": "test"},
            "vector_store": mock_store,
        }

        await retrieve_step(ctx)
        mock_store.query.assert_called_once_with("test", 5)


class TestSynthesizeStep:
    """Tests for the synthesize_step function."""

    @pytest.fixture
    def sample_retrieved(self):
        return [
            {
                "id": "entry-1",
                "content": "Nullifiers prevent double-spending.",
                "metadata": {"type": "entry", "topic": "Nullifiers"},
            },
            {
                "id": "entry-2",
                "content": "ZK proofs verify nullifier uniqueness.",
                "metadata": {"type": "entry", "topic": "ZK Proofs"},
            },
        ]

    @pytest.mark.asyncio
    async def test_returns_answer_and_sources(self, sample_retrieved):
        """Should return synthesized answer with sources."""
        from pipelines import synthesize_step

        mock_client = MockLLMClient([
            make_llm_response("Nullifiers are cryptographic values [entry-1] used in ZK systems [entry-2].")
        ])

        ctx = {
            "input": {"query": "What are nullifiers?"},
            "retrieve": sample_retrieved,
            "llm": mock_client,
        }

        result = await synthesize_step(ctx)

        assert result["answer"] == "Nullifiers are cryptographic values [entry-1] used in ZK systems [entry-2]."
        assert result["sources"] == ["entry-1", "entry-2"]
        assert "model" in result
        assert "error" not in result

    @pytest.mark.asyncio
    async def test_handles_empty_retrieved(self):
        """Should return no-documents message when nothing retrieved."""
        from pipelines import synthesize_step

        mock_client = MockLLMClient([])

        ctx = {
            "input": {"query": "test"},
            "retrieve": [],
            "llm": mock_client,
        }

        result = await synthesize_step(ctx)

        assert "No relevant documents" in result["answer"]
        assert result["sources"] == []
        assert len(mock_client.calls) == 0  # LLM should not be called

    @pytest.mark.asyncio
    async def test_handles_llm_error(self, sample_retrieved):
        """Should handle LLM errors gracefully."""
        from pipelines import synthesize_step

        class FailingClient(MockLLMClient):
            async def complete(self, params):
                raise JigLLMError("Rate limit exceeded", provider="anthropic")

        ctx = {
            "input": {"query": "test"},
            "retrieve": sample_retrieved,
            "llm": FailingClient([]),
        }

        result = await synthesize_step(ctx)

        assert "error" in result
        assert "Rate limit" in result["answer"]
        assert result["sources"] == []

    @pytest.mark.asyncio
    async def test_passes_correct_completion_params(self, sample_retrieved):
        """Should pass correct CompletionParams to LLM."""
        from pipelines import synthesize_step

        mock_client = MockLLMClient([make_llm_response("Answer.")])

        ctx = {
            "input": {"query": "What are nullifiers?"},
            "retrieve": sample_retrieved,
            "llm": mock_client,
        }

        await synthesize_step(ctx)

        assert len(mock_client.calls) == 1
        params = mock_client.calls[0]
        assert params.max_tokens == 1024
        assert len(params.messages) == 1
        assert params.messages[0].role.value == "user"
        assert "What are nullifiers?" in params.messages[0].content


class TestProposeStep:
    """Tests for the propose_step function."""

    @pytest.fixture
    def sample_input(self):
        return {
            "entry": {
                "id": "entry-test",
                "content": "Test entry content about nullifiers",
                "metadata": {"type": "entry", "topic": "Nullifiers"},
            },
            "summary": {
                "id": "summary-nullifiers",
                "content": "Existing summary about nullifiers",
                "metadata": {"type": "summary", "topic": "Nullifiers"},
                "score": 0.85,
                "match_reason": "semantic_similarity",
            },
        }

    @pytest.mark.asyncio
    async def test_returns_valid_proposal(self, sample_input):
        """Should return valid proposal from LLM response."""
        from pipelines import propose_step

        llm_text = json.dumps({
            "new_learnings": [{"insight": "Poseidon hash is efficient", "context": "From analysis"}],
            "rationale": "Entry provides new insights",
        })
        mock_client = MockLLMClient([make_llm_response(llm_text)])

        ctx = {"input": sample_input, "llm": mock_client}
        result = await propose_step(ctx)

        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
        assert "new_learnings" in result
        assert result["match_score"] == 0.85

    @pytest.mark.asyncio
    async def test_handles_json_parse_error(self, sample_input):
        """Should handle invalid JSON gracefully."""
        from pipelines import propose_step

        mock_client = MockLLMClient([make_llm_response("This is not valid JSON {{{")])

        ctx = {"input": sample_input, "llm": mock_client}
        result = await propose_step(ctx)

        assert "error" in result
        assert "Failed to parse" in result["error"]
        assert result["target_summary_id"] == "summary-nullifiers"

    @pytest.mark.asyncio
    async def test_handles_llm_error(self, sample_input):
        """Should handle LLM errors gracefully."""
        from pipelines import propose_step

        class FailingClient(MockLLMClient):
            async def complete(self, params):
                raise JigLLMError("Service unavailable", provider="anthropic")

        ctx = {"input": sample_input, "llm": FailingClient([])}
        result = await propose_step(ctx)

        assert "error" in result
        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"

    @pytest.mark.asyncio
    async def test_no_updates_response(self, sample_input):
        """Should pass through no_updates response."""
        from pipelines import propose_step

        llm_text = json.dumps({"no_updates": True, "rationale": "No new info"})
        mock_client = MockLLMClient([make_llm_response(llm_text)])

        ctx = {"input": sample_input, "llm": mock_client}
        result = await propose_step(ctx)

        assert result.get("no_updates") is True


class TestQueryPipelineIntegration:
    """Integration tests for the query pipeline."""

    @pytest.mark.asyncio
    async def test_end_to_end_query(self):
        """Should run full query pipeline with mocks."""
        from pipelines import build_query_pipeline

        mock_store = MagicMock()
        mock_store.query.return_value = [
            {"id": "doc-1", "content": "ZK content", "metadata": {"type": "entry", "topic": "ZK"}},
        ]

        mock_client = MockLLMClient([make_llm_response("Synthesized answer about ZK [doc-1].")])
        tracer = StdoutTracer(color=False)

        pipeline = build_query_pipeline(tracer)
        result = await run_pipeline(
            pipeline,
            input={"query": "What is ZK?", "n_results": 3},
            context={"vector_store": mock_store, "llm": mock_client},
        )

        assert result.output["answer"] == "Synthesized answer about ZK [doc-1]."
        assert result.output["sources"] == ["doc-1"]
        assert "retrieve" in result.step_outputs
        assert "synthesize" in result.step_outputs
        assert result.duration_ms > 0


class TestProposalMapPipeline:
    """Integration tests for the proposal pipeline with map_pipeline."""

    @pytest.mark.asyncio
    async def test_fan_out_proposals(self):
        """Should generate proposals for multiple summaries."""
        from pipelines import build_proposal_pipeline

        entry = {
            "id": "entry-test",
            "content": "New entry content",
            "metadata": {"type": "entry", "topic": "Test"},
        }

        summaries = [
            {"id": "summary-1", "content": "Summary 1", "metadata": {}, "score": 0.9, "match_reason": "semantic"},
            {"id": "summary-2", "content": "Summary 2", "metadata": {}, "score": 0.7, "match_reason": "tag_overlap"},
        ]

        responses = [
            make_llm_response(json.dumps({"new_learnings": [{"insight": "L1"}], "rationale": "R1"})),
            make_llm_response(json.dumps({"no_updates": True, "rationale": "No new info"})),
        ]
        mock_client = MockLLMClient(responses)
        tracer = StdoutTracer(color=False)

        proposal_pipeline = build_proposal_pipeline(tracer)
        map_result = await map_pipeline(
            proposal_pipeline,
            items=[{"entry": entry, "summary": s} for s in summaries],
            context={"llm": mock_client},
        )

        assert len(map_result.results) == 2

        # First proposal has updates
        assert map_result.results[0].output["target_summary_id"] == "summary-1"
        assert "new_learnings" in map_result.results[0].output

        # Second proposal has no_updates
        assert map_result.results[1].output.get("no_updates") is True

        # Filter like the real endpoint does
        proposals = [
            r.output for r in map_result.results
            if not r.output.get("no_updates") and not r.output.get("error")
        ]
        assert len(proposals) == 1
        assert proposals[0]["target_summary_id"] == "summary-1"
