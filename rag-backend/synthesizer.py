"""
Algerknown RAG - Synthesizer

Takes retrieved documents and asks the synthesizer agent to produce a
cited answer via ``jig.run_agent``. The agent returns a typed
``SynthesizedAnswer`` with the answer text and cited document IDs.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from jig import AgentConfig, ToolRegistry, from_model, run_agent
from jig.feedback.loop import SQLiteFeedbackLoop
from jig.tracing.sqlite import SQLiteTracer
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.getenv("SYNTHESIZER_MODEL", "claude-sonnet-4-6")
DEFAULT_MAX_CONTEXT_TOKENS = int(os.getenv("SYNTHESIZER_MAX_CONTEXT_TOKENS", "12000"))


# --- Schema ----------------------------------------------------------------


class SynthesizedAnswer(BaseModel):
    """Typed output of the synthesizer agent."""

    answer: str
    cited_document_ids: list[str] = Field(default_factory=list)


# --- Prompt building -------------------------------------------------------


_SYNTHESIZER_SYSTEM_PROMPT = """You are a knowledge assistant for a personal knowledge \
base about ZK proofs, privacy, cryptography, and related topics.

Answer the user's query using only the retrieved documents. Call \
`submit_output` with:

- `answer`: the synthesized answer. Cite document ids inline using \
`[document-id]` (e.g. `[zksnarks]`). If the documents don't cover the query, \
say so directly.
- `cited_document_ids`: the list of document ids you cited in `answer`.

Rules:
- Synthesize across documents when relevant.
- Prioritize learnings and decisions.
- Mention related open questions when they bear on the query.
- Be concise.
"""


def _format_context(
    retrieved_entries: list[dict[str, Any]], max_context_chars: int
) -> tuple[str, list[str]]:
    """Fit retrieved docs under the char budget; return (context, used_ids)."""
    parts: list[str] = []
    used_ids: list[str] = []
    total = 0

    for entry in retrieved_entries:
        topic = entry.get("metadata", {}).get("topic", "")
        doc_type = entry.get("metadata", {}).get("type", "entry")
        part = (
            f'<document id="{entry["id"]}" type="{doc_type}" topic="{topic}">\n'
            f'{entry["content"]}\n'
            f"</document>"
        )
        if total + len(part) > max_context_chars:
            logger.warning("Context truncated at %d entries", len(parts))
            break
        parts.append(part)
        used_ids.append(entry["id"])
        total += len(part)

    return "\n\n".join(parts), used_ids


def _user_prompt(query: str, context: str) -> str:
    return (
        f"<retrieved_documents>\n{context}\n</retrieved_documents>\n\n"
        f"<query>{query}</query>"
    )


# --- Module-level tracer/feedback singletons ---

_tracer: SQLiteTracer | None = None
_feedback: SQLiteFeedbackLoop | None = None


def _get_tracer() -> SQLiteTracer:
    global _tracer
    if _tracer is None:
        _tracer = SQLiteTracer(db_path=os.getenv("TRACE_DB_PATH", "./traces.db"))
    return _tracer


def _get_feedback() -> SQLiteFeedbackLoop:
    global _feedback
    if _feedback is None:
        _feedback = SQLiteFeedbackLoop(
            db_path=os.getenv("FEEDBACK_DB_PATH", "./feedback.db"),
        )
    return _feedback


def _build_config(*, model: str) -> AgentConfig[SynthesizedAnswer]:
    return AgentConfig[SynthesizedAnswer](
        name="synthesizer",
        description="Algerknown synthesizer: cited answer from retrieved documents.",
        system_prompt=_SYNTHESIZER_SYSTEM_PROMPT,
        llm=from_model(model),
        feedback=_get_feedback(),
        tracer=_get_tracer(),
        tools=ToolRegistry([]),
        output_schema=SynthesizedAnswer,
        max_parse_retries=2,
        include_memory_in_prompt=False,
        include_feedback_in_prompt=False,
    )


# --- Public API ------------------------------------------------------------


async def synthesize_answer(
    query: str,
    retrieved_entries: list[dict[str, Any]],
    model: str = DEFAULT_MODEL,
    max_context_tokens: int = DEFAULT_MAX_CONTEXT_TOKENS,
) -> dict[str, Any]:
    """Run the synthesizer agent; return ``{answer, sources, model, error?}``."""
    max_chars = max_context_tokens * 4
    context, used_ids = _format_context(retrieved_entries, max_chars)

    config = _build_config(model=model)

    try:
        result = await run_agent(config, _user_prompt(query, context))
    except Exception as e:
        logger.error("Synthesizer run_agent raised: %s", e, exc_info=True)
        return {
            "answer": f"Error generating answer: {e}",
            "sources": [],
            "error": str(e),
        }

    if result.error is not None:
        logger.warning("Synthesizer terminated with agent error: %s", result.error)
        return {
            "answer": f"Error generating answer: {result.error}",
            "sources": [],
            "error": str(result.error),
        }

    answer = result.parsed
    if answer is None:
        return {
            "answer": "Synthesizer returned no parsed output.",
            "sources": [],
            "error": "no parsed output",
        }

    # Prefer the agent's own cited ids if set; otherwise fall back to the
    # ids we included in context so callers always get something useful.
    sources = answer.cited_document_ids or used_ids

    return {
        "answer": answer.answer,
        "sources": sources,
        "model": model,
    }
