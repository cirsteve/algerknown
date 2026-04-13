"""
Algerknown RAG - Pipeline Definitions

jig pipeline configurations for query synthesis and proposal generation.
"""

import json
import logging

from jig import (
    CompletionParams,
    Message,
    PipelineConfig,
    Role,
    Step,
    TracingLogger,
    map_pipeline,
)
from jig.core.errors import JigLLMError

from synthesizer import build_synthesis_prompt
from proposer import build_proposal_prompt, parse_proposal_response

logger = logging.getLogger(__name__)


# ============ Step Functions ============


async def retrieve_step(ctx: dict) -> list[dict]:
    """Retrieve relevant documents from the vector store."""
    query = ctx["input"]["query"]
    n_results = ctx["input"].get("n_results", 5)
    vector_store = ctx["vector_store"]

    return vector_store.query(query, n_results)


async def synthesize_step(ctx: dict) -> dict:
    """Synthesize an answer from retrieved documents using the LLM."""
    query = ctx["input"]["query"]
    retrieved = ctx["retrieve"]
    llm = ctx["llm"]

    if not retrieved:
        return {
            "answer": "No relevant documents found for your query.",
            "sources": [],
        }

    prompt, source_ids = build_synthesis_prompt(query, retrieved)

    try:
        response = await llm.complete(CompletionParams(
            messages=[Message(role=Role.USER, content=prompt)],
            max_tokens=1024,
        ))

        return {
            "answer": response.content,
            "sources": source_ids,
            "model": response.model,
        }

    except JigLLMError as e:
        logger.error(f"LLM error in synthesis: {e}")
        return {
            "answer": f"Error generating answer: {str(e)}",
            "sources": [],
            "error": str(e),
        }


async def propose_step(ctx: dict) -> dict:
    """Generate a proposal for updating a summary based on a new entry."""
    entry = ctx["input"]["entry"]
    summary = ctx["input"]["summary"]
    llm = ctx["llm"]

    prompt = build_proposal_prompt(entry, summary)

    try:
        response = await llm.complete(CompletionParams(
            messages=[Message(role=Role.USER, content=prompt)],
            max_tokens=1024,
        ))

        return parse_proposal_response(response.content, summary, entry)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM response: {e}")
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": "Failed to parse LLM response",
            "raw_response": response.content if 'response' in dir() else None,
        }
    except JigLLMError as e:
        logger.error(f"LLM error in proposal: {e}")
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": str(e),
        }


# ============ Pipeline Builders ============


def build_query_pipeline(tracer: TracingLogger) -> PipelineConfig:
    """Build the query synthesis pipeline.

    Steps:
        1. retrieve - Vector store similarity search
        2. synthesize - LLM synthesis with citations

    Context required:
        vector_store: VectorStore instance
        llm: LLMClient instance

    Input: {"query": str, "n_results": int}
    Output: {"answer": str, "sources": list[str], "model": str}
    """
    return PipelineConfig(
        name="query",
        steps=[
            Step(name="retrieve", fn=retrieve_step),
            Step(name="synthesize", fn=synthesize_step),
        ],
        tracer=tracer,
    )


def build_proposal_pipeline(tracer: TracingLogger) -> PipelineConfig:
    """Build the proposal generation pipeline (single entry-summary pair).

    Used via map_pipeline() to fan out over multiple summaries.

    Steps:
        1. propose - Build prompt, call LLM, parse JSON response

    Context required:
        llm: LLMClient instance

    Input: {"entry": dict, "summary": dict}
    Output: proposal dict
    """
    return PipelineConfig(
        name="proposal",
        steps=[
            Step(name="propose", fn=propose_step),
        ],
        tracer=tracer,
    )
