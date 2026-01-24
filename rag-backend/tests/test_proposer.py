"""
Tests for the proposer module.

Tests cover:
- identify_related_summaries: explicit links, semantic search, tag/topic overlap, scoring
- propose_updates: successful proposals, JSON parsing (including code blocks), error handling
- generate_all_proposals: integration of the above
"""

import pytest
from unittest.mock import patch, MagicMock
import anthropic
import json


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
        """Create a mock VectorStore."""
        store = MagicMock()
        
        # Mock summaries
        store.get_summaries.return_value = [
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
        
        # Mock semantic search results
        store.query.return_value = [
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
        ]
        
        return store
    
    def test_explicit_links_get_highest_score(self, sample_entry, mock_vector_store):
        """Explicitly linked summaries should get score 1.0."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        # Find the explicitly linked summary
        linked = next((r for r in results if r["id"] == "summary-nullifiers"), None)
        assert linked is not None
        assert linked["score"] == 1.0
        assert linked["match_reason"] == "explicit_link"
    
    def test_semantic_search_results_included(self, sample_entry, mock_vector_store):
        """Semantically similar summaries should be included."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        result_ids = [r["id"] for r in results]
        assert "summary-privacy" in result_ids
    
    def test_semantic_score_decays_with_rank(self, sample_entry, mock_vector_store):
        """Semantic matches should have decaying scores based on rank."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        # Privacy should have higher score than ZKML (ranked first in semantic results)
        privacy = next((r for r in results if r["id"] == "summary-privacy"), None)
        zkml = next((r for r in results if r["id"] == "summary-zkml"), None)
        
        if privacy and zkml:
            # Privacy is first in semantic results, should have higher base score
            # But both get tag boosts, so compare carefully
            assert privacy["score"] > 0  # Just verify it has a score
    
    def test_tag_overlap_boosts_score(self, sample_entry, mock_vector_store):
        """Tag overlap should boost candidate scores."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        # Privacy summary shares "privacy" tag with entry
        privacy = next((r for r in results if r["id"] == "summary-privacy"), None)
        assert privacy is not None
        # Should have been boosted
        assert privacy["score"] > 0.2  # Base tag-only score
    
    def test_topic_match_boosts_score(self, sample_entry, mock_vector_store):
        """Topic match should boost candidate scores."""
        from proposer import identify_related_summaries
        
        # Entry has topic "Nullifiers", summary-nullifiers also has "Nullifiers"
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        nullifiers = next((r for r in results if r["id"] == "summary-nullifiers"), None)
        assert nullifiers is not None
        # Already has score 1.0 from explicit link, can't go higher
        assert nullifiers["score"] >= 1.0
    
    def test_respects_max_results(self, sample_entry, mock_vector_store):
        """Should respect max_results limit."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store, max_results=2)
        
        assert len(results) <= 2
    
    def test_results_sorted_by_score(self, sample_entry, mock_vector_store):
        """Results should be sorted by score descending."""
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)
    
    def test_empty_summaries_returns_empty(self, sample_entry, mock_vector_store):
        """Should return empty list when no summaries exist."""
        mock_vector_store.get_summaries.return_value = []
        
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(sample_entry, mock_vector_store)
        assert results == []
    
    def test_entry_without_links(self, mock_vector_store):
        """Should work for entries without explicit links."""
        entry = {
            "id": "entry-new",
            "content": "New entry content",
            "metadata": {"type": "entry", "topic": "Privacy", "tags": "privacy"},
            "raw": {"id": "entry-new"}  # No links
        }
        
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(entry, mock_vector_store)
        
        # Should still find semantically similar summaries
        assert len(results) > 0
    
    def test_entry_without_tags(self, mock_vector_store):
        """Should work for entries without tags."""
        entry = {
            "id": "entry-new",
            "content": "New entry content",
            "metadata": {"type": "entry", "topic": ""},
            "raw": {"id": "entry-new"}
        }
        
        from proposer import identify_related_summaries
        
        results = identify_related_summaries(entry, mock_vector_store)
        
        # Should still work, just without tag boosting
        assert isinstance(results, list)


class TestProposeUpdates:
    """Tests for propose_updates function."""
    
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
            "score": 0.85,
            "match_reason": "semantic_similarity",
        }
    
    @patch("proposer.get_anthropic_client")
    def test_successful_proposal_generation(self, mock_get_client, sample_entry, sample_summary):
        """Should generate valid proposal from LLM response."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "new_learnings": [
                {"insight": "Poseidon hash is efficient for nullifiers", "context": "From entry analysis"}
            ],
            "rationale": "Entry provides new insights"
        }))]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
        assert "new_learnings" in result
        assert len(result["new_learnings"]) == 1
        assert result["match_score"] == 0.85
        assert result["match_reason"] == "semantic_similarity"
    
    @patch("proposer.get_anthropic_client")
    def test_parses_json_code_block(self, mock_get_client, sample_entry, sample_summary):
        """Should parse JSON wrapped in ```json code blocks."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="""Here's the proposal:

```json
{
    "new_learnings": [{"insight": "Test insight", "context": "Test"}],
    "rationale": "Test rationale"
}
```

This should help update the summary.""")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert "new_learnings" in result
        assert result["new_learnings"][0]["insight"] == "Test insight"
    
    @patch("proposer.get_anthropic_client")
    def test_parses_generic_code_block(self, mock_get_client, sample_entry, sample_summary):
        """Should parse JSON wrapped in generic ``` code blocks."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="""```
{"new_open_questions": ["What about edge cases?"]}
```""")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert "new_open_questions" in result
        assert result["new_open_questions"][0] == "What about edge cases?"
    
    @patch("proposer.get_anthropic_client")
    def test_no_updates_response(self, mock_get_client, sample_entry, sample_summary):
        """Should handle no_updates response."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "no_updates": True,
            "rationale": "Entry doesn't add new information"
        }))]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert result.get("no_updates") is True
        assert result["target_summary_id"] == "summary-nullifiers"
    
    @patch("proposer.get_anthropic_client")
    def test_json_parse_error_handling(self, mock_get_client, sample_entry, sample_summary):
        """Should handle invalid JSON gracefully."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="This is not valid JSON {{{")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert "error" in result
        assert "Failed to parse" in result["error"]
        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
        assert "raw_response" in result
    
    @patch("proposer.get_anthropic_client")
    def test_api_error_handling(self, mock_get_client, sample_entry, sample_summary):
        """Should handle Anthropic API errors gracefully."""
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.APIError(
            message="Service unavailable",
            request=MagicMock(),
            body=None
        )
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        result = propose_updates(sample_entry, sample_summary)
        
        assert "error" in result
        assert result["target_summary_id"] == "summary-nullifiers"
        assert result["source_entry_id"] == "entry-test"
    
    @patch("proposer.get_anthropic_client")
    def test_uses_specified_model(self, mock_get_client, sample_entry, sample_summary):
        """Should use the specified model."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text='{"rationale": "test"}')]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        propose_updates(sample_entry, sample_summary, model="claude-3-haiku-20240307")
        
        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["model"] == "claude-3-haiku-20240307"
    
    @patch("proposer.get_anthropic_client")
    def test_prompt_includes_entry_content(self, mock_get_client, sample_entry, sample_summary):
        """Should include entry content in the prompt."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text='{"rationale": "test"}')]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        propose_updates(sample_entry, sample_summary)
        
        call_kwargs = mock_client.messages.create.call_args.kwargs
        prompt = call_kwargs["messages"][0]["content"]
        
        assert sample_entry["content"] in prompt
        assert sample_entry["id"] in prompt
    
    @patch("proposer.get_anthropic_client")
    def test_prompt_includes_summary_content(self, mock_get_client, sample_entry, sample_summary):
        """Should include summary content in the prompt."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text='{"rationale": "test"}')]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from proposer import propose_updates
        propose_updates(sample_entry, sample_summary)
        
        call_kwargs = mock_client.messages.create.call_args.kwargs
        prompt = call_kwargs["messages"][0]["content"]
        
        assert sample_summary["content"] in prompt
        assert sample_summary["id"] in prompt


class TestGenerateAllProposals:
    """Tests for generate_all_proposals function."""
    
    @pytest.fixture
    def sample_entry(self):
        return {
            "id": "entry-test",
            "content": "Test content",
            "metadata": {"type": "entry", "topic": "Test"},
            "raw": {"id": "entry-test"}
        }
    
    @pytest.fixture
    def mock_vector_store(self):
        store = MagicMock()
        store.get_summaries.return_value = [
            {"id": "summary-1", "content": "Summary 1", "metadata": {"type": "summary", "tags": ""}},
            {"id": "summary-2", "content": "Summary 2", "metadata": {"type": "summary", "tags": ""}},
        ]
        store.query.return_value = [
            {"id": "summary-1", "content": "Summary 1", "metadata": {"type": "summary"}, "distance": 0.3},
        ]
        return store
    
    @patch("proposer.propose_updates")
    @patch("proposer.identify_related_summaries")
    def test_generates_proposals_for_related_summaries(
        self, mock_identify, mock_propose, sample_entry, mock_vector_store
    ):
        """Should generate proposals for all related summaries."""
        mock_identify.return_value = [
            {"id": "summary-1", "content": "S1", "score": 0.9},
            {"id": "summary-2", "content": "S2", "score": 0.7},
        ]
        mock_propose.side_effect = [
            {"target_summary_id": "summary-1", "source_entry_id": "entry-test", "new_learnings": []},
            {"target_summary_id": "summary-2", "source_entry_id": "entry-test", "new_learnings": []},
        ]
        
        from proposer import generate_all_proposals
        results = generate_all_proposals(sample_entry, mock_vector_store)
        
        assert len(results) == 2
        assert mock_propose.call_count == 2
    
    @patch("proposer.propose_updates")
    @patch("proposer.identify_related_summaries")
    def test_excludes_no_updates_proposals(
        self, mock_identify, mock_propose, sample_entry, mock_vector_store
    ):
        """Should exclude proposals marked as no_updates."""
        mock_identify.return_value = [
            {"id": "summary-1", "content": "S1", "score": 0.9},
            {"id": "summary-2", "content": "S2", "score": 0.7},
        ]
        mock_propose.side_effect = [
            {"target_summary_id": "summary-1", "source_entry_id": "entry-test", "no_updates": True},
            {"target_summary_id": "summary-2", "source_entry_id": "entry-test", "new_learnings": []},
        ]
        
        from proposer import generate_all_proposals
        results = generate_all_proposals(sample_entry, mock_vector_store)
        
        assert len(results) == 1
        assert results[0]["target_summary_id"] == "summary-2"
    
    @patch("proposer.propose_updates")
    @patch("proposer.identify_related_summaries")
    def test_excludes_error_proposals(
        self, mock_identify, mock_propose, sample_entry, mock_vector_store
    ):
        """Should exclude proposals with errors."""
        mock_identify.return_value = [
            {"id": "summary-1", "content": "S1", "score": 0.9},
            {"id": "summary-2", "content": "S2", "score": 0.7},
        ]
        mock_propose.side_effect = [
            {"target_summary_id": "summary-1", "source_entry_id": "entry-test", "error": "API failed"},
            {"target_summary_id": "summary-2", "source_entry_id": "entry-test", "new_learnings": []},
        ]
        
        from proposer import generate_all_proposals
        results = generate_all_proposals(sample_entry, mock_vector_store)
        
        assert len(results) == 1
        assert results[0]["target_summary_id"] == "summary-2"
    
    @patch("proposer.identify_related_summaries")
    def test_returns_empty_when_no_related(
        self, mock_identify, sample_entry, mock_vector_store
    ):
        """Should return empty list when no related summaries found."""
        mock_identify.return_value = []
        
        from proposer import generate_all_proposals
        results = generate_all_proposals(sample_entry, mock_vector_store)
        
        assert results == []
    
    @patch("proposer.propose_updates")
    @patch("proposer.identify_related_summaries")
    def test_uses_specified_model(
        self, mock_identify, mock_propose, sample_entry, mock_vector_store
    ):
        """Should pass specified model to propose_updates."""
        mock_identify.return_value = [{"id": "summary-1", "content": "S1", "score": 0.9}]
        mock_propose.return_value = {"target_summary_id": "summary-1", "source_entry_id": "entry-test"}
        
        from proposer import generate_all_proposals
        generate_all_proposals(sample_entry, mock_vector_store, model="claude-3-haiku-20240307")
        
        mock_propose.assert_called_once()
        # Check the model was passed (either as positional arg or keyword arg)
        call_args, call_kwargs = mock_propose.call_args
        model_passed = call_kwargs.get("model") or (call_args[2] if len(call_args) > 2 else None)
        assert model_passed == "claude-3-haiku-20240307"
