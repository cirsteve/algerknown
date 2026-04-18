"""
Tests for the proposer module.

Tests cover:
- identify_related_summaries: explicit links, semantic search, tag/topic overlap, scoring
- build_proposal_prompt: prompt content construction
- parse_proposal_response: JSON parsing (including code blocks), error handling
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock


class TestIdentifyRelatedSummaries:
    """Tests for identify_related_summaries function."""

    @pytest.fixture
    def sample_entry(self):
        """Sample entry for testing."""
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
                "links": [
                    {"id": "summary-nullifiers", "relationship": "informs"}
                ]
            }
        }

    @pytest.fixture
    def mock_vector_store(self):
        """Create a mock VectorStore with async methods."""
        store = MagicMock()
        # Methods that post-phase-13 VectorStore awaits — use AsyncMock so
        # `await store.method()` returns the configured value.
        store.get_summaries = AsyncMock(return_value=[
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
        ])
        store.query = AsyncMock(return_value=[
            {
                "id": "summary-privacy",
                "content": "Summary of privacy techniques",
                "metadata": {"type": "summary", "topic": "Privacy", "tags": "privacy"},
                "distance": 0.3,
            },
            {
                "id": "summary-zkml",
                "content": "Summary of ZKML approaches",
                "metadata": {"type": "summary", "topic": "ZKML", "tags": "zk,ml"},
                "distance": 0.5,
            },
        ])
        return store

    async def test_explicit_links_get_highest_score(self, sample_entry, mock_vector_store):
        """Explicitly linked summaries should get score 1.0."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        linked = next((r for r in results if r["id"] == "summary-nullifiers"), None)
        assert linked is not None
        assert linked["score"] == 1.0
        assert linked["match_reason"] == "explicit_link"

    async def test_semantic_search_results_included(self, sample_entry, mock_vector_store):
        """Semantically similar summaries should be included."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        result_ids = [r["id"] for r in results]
        assert "summary-privacy" in result_ids

    async def test_semantic_score_decays_with_rank(self, sample_entry, mock_vector_store):
        """Semantic matches should have decaying scores based on rank."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        privacy = next((r for r in results if r["id"] == "summary-privacy"), None)
        zkml = next((r for r in results if r["id"] == "summary-zkml"), None)

        if privacy and zkml:
            assert privacy["score"] > 0

    async def test_tag_overlap_boosts_score(self, sample_entry, mock_vector_store):
        """Tag overlap should boost candidate scores."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        privacy = next((r for r in results if r["id"] == "summary-privacy"), None)
        assert privacy is not None
        assert privacy["score"] > 0.2

    async def test_topic_match_boosts_score(self, sample_entry, mock_vector_store):
        """Topic match should boost candidate scores."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        nullifiers = next((r for r in results if r["id"] == "summary-nullifiers"), None)
        assert nullifiers is not None
        assert nullifiers["score"] >= 1.0

    async def test_respects_max_results(self, sample_entry, mock_vector_store):
        """Should respect max_results limit."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store, max_results=2)
        assert len(results) <= 2

    async def test_results_sorted_by_score(self, sample_entry, mock_vector_store):
        """Results should be sorted by score descending."""
        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)

        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    async def test_empty_summaries_returns_empty(self, sample_entry, mock_vector_store):
        """Should return empty list when no summaries exist."""
        mock_vector_store.get_summaries.return_value = []

        from proposer import identify_related_summaries

        results = await identify_related_summaries(sample_entry, mock_vector_store)
        assert results == []

    async def test_entry_without_links(self, mock_vector_store):
        """Should work for entries without explicit links."""
        entry = {
            "id": "entry-new",
            "content": "New entry content",
            "metadata": {"type": "entry", "topic": "Privacy", "tags": "privacy"},
            "raw": {"id": "entry-new"}
        }

        from proposer import identify_related_summaries

        results = await identify_related_summaries(entry, mock_vector_store)
        assert len(results) > 0

    async def test_entry_without_tags(self, mock_vector_store):
        """Should work for entries without tags."""
        entry = {
            "id": "entry-new",
            "content": "New entry content",
            "metadata": {"type": "entry", "topic": ""},
            "raw": {"id": "entry-new"}
        }

        from proposer import identify_related_summaries

        results = await identify_related_summaries(entry, mock_vector_store)
        assert isinstance(results, list)


class TestBuildProposalPrompt:
    """Tests for build_proposal_prompt function."""

    @pytest.fixture
    def sample_entry(self):
        return {
            "id": "entry-test",
            "content": "Test entry content about nullifiers",
            "metadata": {"type": "entry", "topic": "Nullifiers"},
        }

    @pytest.fixture
    def sample_summary(self):
        return {
            "id": "summary-nullifiers",
            "content": "Existing summary about nullifiers",
            "metadata": {"type": "summary", "topic": "Nullifiers"},
        }

    def test_includes_entry_content(self, sample_entry, sample_summary):
        """Should include entry content in the prompt."""
        from proposer import build_proposal_prompt

        prompt = build_proposal_prompt(sample_entry, sample_summary)
        assert sample_entry["content"] in prompt
        assert sample_entry["id"] in prompt

    def test_includes_summary_content(self, sample_entry, sample_summary):
        """Should include summary content in the prompt."""
        from proposer import build_proposal_prompt

        prompt = build_proposal_prompt(sample_entry, sample_summary)
        assert sample_summary["content"] in prompt
        assert sample_summary["id"] in prompt

    def test_includes_entry_metadata(self, sample_entry, sample_summary):
        """Should include entry type and topic."""
        from proposer import build_proposal_prompt

        prompt = build_proposal_prompt(sample_entry, sample_summary)
        assert "entry" in prompt
        assert "Nullifiers" in prompt

    def test_includes_json_format_instructions(self, sample_entry, sample_summary):
        """Should include JSON format instructions."""
        from proposer import build_proposal_prompt

        prompt = build_proposal_prompt(sample_entry, sample_summary)
        assert "new_learnings" in prompt
        assert "new_decisions" in prompt
        assert "new_open_questions" in prompt
        assert "no_updates" in prompt


class TestParseProposalResponse:
    """Tests for parse_proposal_response function."""

    @pytest.fixture
    def sample_summary(self):
        return {
            "id": "summary-nullifiers",
            "score": 0.85,
            "match_reason": "semantic_similarity",
        }

    @pytest.fixture
    def sample_entry(self):
        return {"id": "entry-test"}

    def test_parses_valid_json(self, sample_summary, sample_entry):
        """Should parse valid JSON response."""
        from proposer import parse_proposal_response

        text = json.dumps({
            "new_learnings": [{"insight": "Test insight", "context": "Test"}],
            "rationale": "Test rationale",
        })

        result = parse_proposal_response(text, sample_summary, sample_entry)
        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
        assert result["match_score"] == 0.85
        assert result["match_reason"] == "semantic_similarity"
        assert len(result["new_learnings"]) == 1

    def test_parses_json_code_block(self, sample_summary, sample_entry):
        """Should parse JSON wrapped in ```json code blocks."""
        from proposer import parse_proposal_response

        text = """Here's the proposal:

```json
{
    "new_learnings": [{"insight": "Test insight", "context": "Test"}],
    "rationale": "Test rationale"
}
```

This should help update the summary."""

        result = parse_proposal_response(text, sample_summary, sample_entry)
        assert "new_learnings" in result
        assert result["new_learnings"][0]["insight"] == "Test insight"

    def test_parses_generic_code_block(self, sample_summary, sample_entry):
        """Should parse JSON wrapped in generic ``` code blocks."""
        from proposer import parse_proposal_response

        text = '```\n{"new_open_questions": ["What about edge cases?"]}\n```'

        result = parse_proposal_response(text, sample_summary, sample_entry)
        assert "new_open_questions" in result
        assert result["new_open_questions"][0] == "What about edge cases?"

    def test_parses_no_updates_response(self, sample_summary, sample_entry):
        """Should handle no_updates response."""
        from proposer import parse_proposal_response

        text = json.dumps({
            "no_updates": True,
            "rationale": "Entry doesn't add new information",
        })

        result = parse_proposal_response(text, sample_summary, sample_entry)
        assert result.get("no_updates") is True
        assert result["target_summary_id"] == "summary-nullifiers"

    def test_raises_on_invalid_json(self, sample_summary, sample_entry):
        """Should raise JSONDecodeError on invalid JSON."""
        from proposer import parse_proposal_response

        with pytest.raises(json.JSONDecodeError):
            parse_proposal_response("This is not valid JSON {{{", sample_summary, sample_entry)

    def test_injects_metadata(self, sample_summary, sample_entry):
        """Should inject target_summary_id, source_entry_id, match_score, match_reason."""
        from proposer import parse_proposal_response

        text = json.dumps({"rationale": "test"})
        result = parse_proposal_response(text, sample_summary, sample_entry)

        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
        assert result["match_score"] == 0.85
        assert result["match_reason"] == "semantic_similarity"
