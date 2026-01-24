"""
Tests for the synthesizer module.

Tests cover:
- Successful synthesis with mocked Anthropic client
- Context truncation when entries exceed max tokens
- API error handling
- Empty entries handling
- Citation extraction
"""

import pytest
from unittest.mock import patch, MagicMock
import anthropic


class TestGetAnthropicClient:
    """Tests for get_anthropic_client function."""
    
    def test_returns_client_with_valid_key(self):
        """Should return Anthropic client when API key is set."""
        import os
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-valid-key"
        
        from synthesizer import get_anthropic_client
        client = get_anthropic_client()
        
        assert isinstance(client, anthropic.Anthropic)
    
    def test_raises_on_missing_key(self):
        """Should raise ValueError when API key is missing."""
        import os
        old_key = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = ""
        
        try:
            from synthesizer import get_anthropic_client
            with pytest.raises(ValueError, match="ANTHROPIC_API_KEY not configured"):
                get_anthropic_client()
        finally:
            if old_key:
                os.environ["ANTHROPIC_API_KEY"] = old_key
    
    def test_raises_on_placeholder_key(self):
        """Should raise ValueError when API key is placeholder."""
        import os
        old_key = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-..."
        
        try:
            from synthesizer import get_anthropic_client
            with pytest.raises(ValueError, match="ANTHROPIC_API_KEY not configured"):
                get_anthropic_client()
        finally:
            if old_key:
                os.environ["ANTHROPIC_API_KEY"] = old_key


class TestSynthesizeAnswer:
    """Tests for synthesize_answer function."""
    
    @pytest.fixture
    def sample_entries(self):
        """Sample retrieved entries for testing."""
        return [
            {
                "id": "entry-1",
                "content": "Nullifiers are cryptographic values used to prevent double-spending.",
                "metadata": {"type": "entry", "topic": "Nullifiers"},
            },
            {
                "id": "entry-2", 
                "content": "ZK proofs can verify nullifier uniqueness without revealing the value.",
                "metadata": {"type": "entry", "topic": "ZK Proofs"},
            },
        ]
    
    @pytest.fixture
    def mock_anthropic_response(self):
        """Create a mock Anthropic API response."""
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Nullifiers are cryptographic values [entry-1] used in ZK systems [entry-2].")]
        return mock_response
    
    @patch("synthesizer.get_anthropic_client")
    def test_successful_synthesis(self, mock_get_client, sample_entries, mock_anthropic_response):
        """Should return synthesized answer with sources."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        result = synthesize_answer("What are nullifiers?", sample_entries)
        
        assert "answer" in result
        assert "sources" in result
        assert "model" in result
        assert result["answer"] == "Nullifiers are cryptographic values [entry-1] used in ZK systems [entry-2]."
        assert result["sources"] == ["entry-1", "entry-2"]
        assert "error" not in result
    
    @patch("synthesizer.get_anthropic_client")
    def test_includes_correct_model(self, mock_get_client, sample_entries, mock_anthropic_response):
        """Should include the model used in response."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        result = synthesize_answer("test", sample_entries, model="claude-3-haiku-20240307")
        
        assert result["model"] == "claude-3-haiku-20240307"
        
        # Verify the model was passed to the API
        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["model"] == "claude-3-haiku-20240307"
    
    @patch("synthesizer.get_anthropic_client")
    def test_context_truncation(self, mock_get_client, mock_anthropic_response):
        """Should truncate context when entries exceed max tokens."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        # Create entries that exceed the token limit
        large_entries = [
            {
                "id": f"entry-{i}",
                "content": "A" * 10000,  # ~2500 tokens each
                "metadata": {"type": "entry", "topic": f"Topic {i}"},
            }
            for i in range(10)  # 10 entries * 2500 tokens = ~25000 tokens
        ]
        
        from synthesizer import synthesize_answer
        # Set a small max_context_tokens to force truncation
        result = synthesize_answer("test", large_entries, max_context_tokens=3000)
        
        # Should have fewer sources than entries due to truncation
        assert len(result["sources"]) < len(large_entries)
        assert len(result["sources"]) > 0
    
    @patch("synthesizer.get_anthropic_client")  
    def test_empty_entries(self, mock_get_client, mock_anthropic_response):
        """Should handle empty entries list."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="I don't have any documents to reference.")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        result = synthesize_answer("What are nullifiers?", [])
        
        assert "answer" in result
        assert result["sources"] == []
    
    @patch("synthesizer.get_anthropic_client")
    def test_api_error_handling(self, mock_get_client, sample_entries):
        """Should handle Anthropic API errors gracefully."""
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.APIError(
            message="Rate limit exceeded",
            request=MagicMock(),
            body=None
        )
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        result = synthesize_answer("test", sample_entries)
        
        assert "error" in result
        assert "Rate limit" in result["answer"]
        assert result["sources"] == []
    
    @patch("synthesizer.get_anthropic_client")
    def test_prompt_includes_query(self, mock_get_client, sample_entries, mock_anthropic_response):
        """Should include the user query in the prompt."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        synthesize_answer("What are nullifiers used for?", sample_entries)
        
        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs["messages"]
        prompt = messages[0]["content"]
        
        assert "What are nullifiers used for?" in prompt
    
    @patch("synthesizer.get_anthropic_client")
    def test_prompt_includes_document_ids(self, mock_get_client, sample_entries, mock_anthropic_response):
        """Should include document IDs in the context."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        synthesize_answer("test", sample_entries)
        
        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs["messages"]
        prompt = messages[0]["content"]
        
        assert 'id="entry-1"' in prompt
        assert 'id="entry-2"' in prompt
    
    @patch("synthesizer.get_anthropic_client")
    def test_prompt_includes_document_content(self, mock_get_client, sample_entries, mock_anthropic_response):
        """Should include document content in the context."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_anthropic_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_answer
        synthesize_answer("test", sample_entries)
        
        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs["messages"]
        prompt = messages[0]["content"]
        
        assert "Nullifiers are cryptographic values" in prompt
        assert "ZK proofs can verify" in prompt
    
    @patch("synthesizer.get_anthropic_client")
    def test_sources_only_includes_used_entries(self, mock_get_client):
        """Sources should only include entries that fit in context."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Answer based on first entry only.")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        entries = [
            {"id": "small-1", "content": "Short content", "metadata": {}},
            {"id": "huge-1", "content": "X" * 100000, "metadata": {}},  # Will be truncated
        ]
        
        from synthesizer import synthesize_answer
        result = synthesize_answer("test", entries, max_context_tokens=100)
        
        # Only the first entry should fit
        assert "small-1" in result["sources"]
        # The huge entry should be truncated
        assert len(result["sources"]) == 1


class TestSynthesizeWithFollowup:
    """Tests for synthesize_with_followup function."""
    
    @pytest.fixture
    def sample_entries(self):
        return [
            {
                "id": "entry-1",
                "content": "Test content",
                "metadata": {"type": "entry", "topic": "Test"},
            }
        ]
    
    @patch("synthesizer.get_anthropic_client")
    def test_includes_conversation_history(self, mock_get_client, sample_entries):
        """Should include conversation history in messages."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Follow-up answer.")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        history = [
            {"role": "user", "content": "What is ZK?"},
            {"role": "assistant", "content": "ZK stands for zero-knowledge."},
        ]
        
        from synthesizer import synthesize_with_followup
        synthesize_with_followup("Tell me more", sample_entries, conversation_history=history)
        
        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs["messages"]
        
        # Should have history plus the new query
        assert len(messages) >= 3
    
    @patch("synthesizer.get_anthropic_client")
    def test_works_without_history(self, mock_get_client, sample_entries):
        """Should work when no conversation history provided."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Answer without history.")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client
        
        from synthesizer import synthesize_with_followup
        result = synthesize_with_followup("What is ZK?", sample_entries)
        
        assert "answer" in result
