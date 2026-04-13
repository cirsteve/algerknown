"""
Tests for the synthesizer module.

Tests cover:
- build_synthesis_prompt: context formatting, truncation, source tracking
- build_followup_system_prompt: system prompt construction
- synthesize_with_followup: async synthesis with conversation history
"""

import pytest
from helpers import MockLLMClient, make_llm_response


class TestBuildSynthesisPrompt:
    """Tests for build_synthesis_prompt function."""

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

    def test_includes_query_in_prompt(self, sample_entries):
        """Should include the user query in the prompt."""
        from synthesizer import build_synthesis_prompt

        prompt, _ = build_synthesis_prompt("What are nullifiers used for?", sample_entries)
        assert "What are nullifiers used for?" in prompt

    def test_includes_document_ids(self, sample_entries):
        """Should include document IDs in XML format."""
        from synthesizer import build_synthesis_prompt

        prompt, _ = build_synthesis_prompt("test", sample_entries)
        assert 'id="entry-1"' in prompt
        assert 'id="entry-2"' in prompt

    def test_includes_document_content(self, sample_entries):
        """Should include document content in the context."""
        from synthesizer import build_synthesis_prompt

        prompt, _ = build_synthesis_prompt("test", sample_entries)
        assert "Nullifiers are cryptographic values" in prompt
        assert "ZK proofs can verify" in prompt

    def test_includes_document_type_and_topic(self, sample_entries):
        """Should include type and topic in document XML."""
        from synthesizer import build_synthesis_prompt

        prompt, _ = build_synthesis_prompt("test", sample_entries)
        assert 'type="entry"' in prompt
        assert 'topic="Nullifiers"' in prompt

    def test_returns_correct_source_ids(self, sample_entries):
        """Should return source IDs for entries that fit in context."""
        from synthesizer import build_synthesis_prompt

        _, source_ids = build_synthesis_prompt("test", sample_entries)
        assert source_ids == ["entry-1", "entry-2"]

    def test_context_truncation(self):
        """Should truncate context when entries exceed max tokens."""
        from synthesizer import build_synthesis_prompt

        large_entries = [
            {
                "id": f"entry-{i}",
                "content": "A" * 10000,
                "metadata": {"type": "entry", "topic": f"Topic {i}"},
            }
            for i in range(10)
        ]

        _, source_ids = build_synthesis_prompt("test", large_entries, max_context_tokens=3000)
        assert len(source_ids) < len(large_entries)
        assert len(source_ids) > 0

    def test_sources_only_includes_used_entries(self):
        """Sources should only include entries that fit in context."""
        from synthesizer import build_synthesis_prompt

        entries = [
            {"id": "small-1", "content": "Short content", "metadata": {}},
            {"id": "huge-1", "content": "X" * 100000, "metadata": {}},
        ]

        _, source_ids = build_synthesis_prompt("test", entries, max_context_tokens=100)
        assert "small-1" in source_ids
        assert len(source_ids) == 1

    def test_empty_entries(self):
        """Should handle empty entries list."""
        from synthesizer import build_synthesis_prompt

        prompt, source_ids = build_synthesis_prompt("test", [])
        assert source_ids == []
        assert "<query>test</query>" in prompt


class TestBuildFollowupSystemPrompt:
    """Tests for build_followup_system_prompt function."""

    @pytest.fixture
    def sample_entries(self):
        return [
            {
                "id": "entry-1",
                "content": "Test content about nullifiers",
                "metadata": {"type": "entry", "topic": "Nullifiers"},
            },
        ]

    def test_includes_document_context(self, sample_entries):
        """Should include document content in system prompt."""
        from synthesizer import build_followup_system_prompt

        system = build_followup_system_prompt(sample_entries)
        assert "Test content about nullifiers" in system
        assert 'id="entry-1"' in system

    def test_limits_to_10_entries(self):
        """Should only include first 10 entries."""
        from synthesizer import build_followup_system_prompt

        entries = [
            {"id": f"entry-{i}", "content": f"Content {i}", "metadata": {"topic": f"T{i}"}}
            for i in range(15)
        ]

        system = build_followup_system_prompt(entries)
        assert "Content 9" in system
        assert "Content 10" not in system


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

    @pytest.mark.asyncio
    async def test_includes_conversation_history(self, sample_entries):
        """Should include conversation history in LLM call."""
        mock_client = MockLLMClient([make_llm_response("Follow-up answer.")])

        history = [
            {"role": "user", "content": "What is ZK?"},
            {"role": "assistant", "content": "ZK stands for zero-knowledge."},
        ]

        from synthesizer import synthesize_with_followup

        await synthesize_with_followup("Tell me more", sample_entries, mock_client, conversation_history=history)

        assert len(mock_client.calls) == 1
        params = mock_client.calls[0]
        # History (2 messages) + new query = 3 messages
        assert len(params.messages) == 3

    @pytest.mark.asyncio
    async def test_works_without_history(self, sample_entries):
        """Should work when no conversation history provided."""
        mock_client = MockLLMClient([make_llm_response("Answer without history.")])

        from synthesizer import synthesize_with_followup

        result = await synthesize_with_followup("What is ZK?", sample_entries, mock_client)
        assert "answer" in result
        assert result["answer"] == "Answer without history."

    @pytest.mark.asyncio
    async def test_returns_sources(self, sample_entries):
        """Should return entry IDs as sources."""
        mock_client = MockLLMClient([make_llm_response("Answer.")])

        from synthesizer import synthesize_with_followup

        result = await synthesize_with_followup("test", sample_entries, mock_client)
        assert result["sources"] == ["entry-1"]

    @pytest.mark.asyncio
    async def test_uses_system_prompt(self, sample_entries):
        """Should pass a system prompt to the LLM."""
        mock_client = MockLLMClient([make_llm_response("Answer.")])

        from synthesizer import synthesize_with_followup

        await synthesize_with_followup("test", sample_entries, mock_client)

        params = mock_client.calls[0]
        assert params.system is not None
        assert "retrieved documents" in params.system.lower() or "knowledge" in params.system.lower()
