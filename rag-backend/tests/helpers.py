"""
Shared test utilities for the RAG backend tests.
"""

from jig import LLMClient, LLMResponse, Usage, CompletionParams


class MockLLMClient(LLMClient):
    """Mock LLM client that returns canned responses in order."""

    def __init__(self, responses: list[LLMResponse]):
        self._responses = list(responses)
        self._call_index = 0
        self.calls: list[CompletionParams] = []

    async def complete(self, params: CompletionParams) -> LLMResponse:
        self.calls.append(params)
        response = self._responses[self._call_index]
        self._call_index += 1
        return response


def make_llm_response(text: str, model: str = "claude-sonnet-4-20250514") -> LLMResponse:
    """Create a mock LLMResponse with sensible defaults."""
    return LLMResponse(
        content=text,
        tool_calls=None,
        usage=Usage(input_tokens=100, output_tokens=50, cost=None),
        latency_ms=200.0,
        model=model,
    )
