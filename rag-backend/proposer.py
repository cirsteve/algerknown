"""
Algerknown RAG - Proposer

Update proposal generation for ingest mode.

Ranks candidate summaries with explicit-link / semantic / tag scoring
(pure Python) and asks the proposer agent to produce a typed `Proposal`
for each via `jig.run_agent`. The agent returns the proposal as
`submit_output` args; pydantic validates the shape before we hand it
back to the API layer.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from jig import AgentConfig, ToolRegistry, from_model, run_agent
from jig.feedback.loop import SQLiteFeedbackLoop
from jig.memory.local import DenseRetriever, SqliteStore
from jig.tracing.sqlite import SQLiteTracer
from pydantic import BaseModel, Field

from memory_store import get_summaries, search

logger = logging.getLogger(__name__)

DEFAULT_MAX_PROPOSALS = int(os.getenv("MAX_PROPOSALS", "5"))
DEFAULT_MODEL = os.getenv("PROPOSER_MODEL", "claude-sonnet-4-6")


# --- Proposal schema --------------------------------------------------------


class NewLearning(BaseModel):
    insight: str
    context: str = ""
    relevance: list[str] = Field(default_factory=list)


class NewDecision(BaseModel):
    decision: str
    rationale: str = ""
    date: str = ""


class NewLink(BaseModel):
    id: str
    relationship: str = "relates_to"
    notes: str = ""


class Proposal(BaseModel):
    """Typed output of the proposer agent.

    Mirrors ``api.ProposalData`` with optional structured sub-types. The
    agent either populates the update fields *or* sets ``no_updates=True``
    — never both.
    """

    target_summary_id: str = ""
    source_entry_id: str = ""
    new_learnings: list[NewLearning] = Field(default_factory=list)
    new_decisions: list[NewDecision] = Field(default_factory=list)
    new_open_questions: list[str] = Field(default_factory=list)
    new_links: list[NewLink] = Field(default_factory=list)
    rationale: str = ""
    no_updates: bool = False


# --- Candidate ranking (pure Python) ---------------------------------------


async def identify_related_summaries(
    entry: dict[str, Any],
    store: SqliteStore,
    retriever: DenseRetriever,
    max_results: int | None = None,
) -> list[dict[str, Any]]:
    """Rank candidate summaries: explicit links, then semantic, then tag overlap.

    Returns the top ``max_results`` summaries annotated with ``score`` and
    ``match_reason``. The scoring logic matches the pre-phase-13 proposer
    verbatim; only the memory backend changed.
    """
    if max_results is None:
        max_results = DEFAULT_MAX_PROPOSALS

    all_summaries = await get_summaries(store)
    if not all_summaries:
        logger.warning("No summaries found in memory store")
        return []

    candidates: dict[str, dict[str, Any]] = {}

    # 1. Explicit links (highest priority)
    raw_entry = entry.get("raw", {})
    for link in raw_entry.get("links", []):
        link_id = link.get("id", "")
        for summary in all_summaries:
            if summary["id"] == link_id:
                candidates[link_id] = {
                    **summary,
                    "score": 1.0,
                    "match_reason": "explicit_link",
                }
                break

    # 2. Semantic similarity
    similar = await search(
        retriever,
        entry["content"],
        n_results=10,
        where={"type": "summary"},
    )
    for i, doc in enumerate(similar):
        doc_id = doc["id"]
        if doc_id not in candidates:
            score = 0.8 - (i * 0.05)
            candidates[doc_id] = {
                **doc,
                "score": score,
                "match_reason": "semantic_similarity",
            }

    # 3. Tag/topic overlap boost
    entry_metadata = entry.get("metadata", {})
    entry_tags = (
        set(entry_metadata.get("tags", "").split(","))
        if entry_metadata.get("tags")
        else set()
    )
    entry_topic = entry_metadata.get("topic", "")

    for summary in all_summaries:
        s_id = summary["id"]
        s_metadata = summary.get("metadata", {})

        if s_id in candidates and candidates[s_id]["score"] >= 1.0:
            continue

        score_boost = 0.0
        if entry_topic and s_metadata.get("topic") == entry_topic:
            score_boost += 0.3
        s_tags = (
            set(s_metadata.get("tags", "").split(","))
            if s_metadata.get("tags")
            else set()
        )
        common_tags = entry_tags.intersection(s_tags)
        if common_tags:
            score_boost += 0.1 * len(common_tags)

        if score_boost > 0:
            if s_id in candidates:
                candidates[s_id]["score"] += score_boost
                candidates[s_id]["match_reason"] += ",tag_overlap"
            else:
                candidates[s_id] = {
                    **summary,
                    "score": 0.2 + score_boost,
                    "match_reason": "tag_overlap",
                }

    sorted_candidates = sorted(
        candidates.values(), key=lambda x: x["score"], reverse=True
    )
    return sorted_candidates[:max_results]


# --- Agent factory ---------------------------------------------------------


_PROPOSER_SYSTEM_PROMPT = """You maintain a personal knowledge base. A new entry has been \
added; you propose updates to a related summary.

Read the entry and the existing summary. Produce a proposal by calling \
`submit_output` with these fields:

- `new_learnings`: insights the entry adds. Each has `insight`, `context`, and \
`relevance` (a list that should include the entry's id).
- `new_decisions`: explicit decisions documented in the entry. Each has \
`decision`, `rationale`, and `date` (YYYY-MM-DD when available).
- `new_open_questions`: questions the entry raises that the summary doesn't answer.
- `new_links`: cross-references from the summary to the entry. Each has `id` \
(the entry id), `relationship` (one of informs/depends_on/relates_to), and `notes`.
- `rationale`: why these updates are warranted.
- `no_updates`: true when the entry doesn't meaningfully change the summary. In that \
case leave the list fields empty and set `rationale` to explain why.

Rules:
1. Only include items not already present in the summary.
2. Extract specific, actionable insights.
3. If nothing warrants an update, set `no_updates=true` with a short rationale.
4. Keep `insight` lines concise.
"""


def _proposer_user_prompt(entry: dict[str, Any], summary: dict[str, Any]) -> str:
    return (
        f"<new_entry>\n"
        f"ID: {entry['id']}\n"
        f"Type: {entry.get('metadata', {}).get('type', 'entry')}\n"
        f"Topic: {entry.get('metadata', {}).get('topic', '')}\n\n"
        f"{entry['content']}\n"
        f"</new_entry>\n\n"
        f"<existing_summary>\n"
        f"ID: {summary['id']}\n"
        f"Topic: {summary.get('metadata', {}).get('topic', '')}\n\n"
        f"{summary['content']}\n"
        f"</existing_summary>"
    )


def _build_proposer_config(
    *, model: str, tracer: SQLiteTracer, feedback: SQLiteFeedbackLoop
) -> AgentConfig[Proposal]:
    return AgentConfig[Proposal](
        name="proposer",
        description="Algerknown proposer: produce typed update proposals for summaries.",
        system_prompt=_PROPOSER_SYSTEM_PROMPT,
        llm=from_model(model),
        feedback=feedback,
        tracer=tracer,
        tools=ToolRegistry([]),
        output_schema=Proposal,
        max_parse_retries=2,
        include_memory_in_prompt=False,
        include_feedback_in_prompt=False,
    )


# --- Module-level tracer/feedback singletons ---
# Cheap to construct (SQLite setup is lazy); shared across ingest requests.
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


async def propose_updates(
    entry: dict[str, Any],
    summary: dict[str, Any],
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Run the proposer agent against one (entry, summary) pair.

    Returns a dict matching the `ProposalData` API shape with
    ``target_summary_id``, ``source_entry_id``, and the agent's typed
    fields merged in. On agent failure returns a dict containing
    ``error`` so the caller can skip or log.
    """
    config = _build_proposer_config(
        model=model, tracer=_get_tracer(), feedback=_get_feedback()
    )

    try:
        result = await run_agent(config, _proposer_user_prompt(entry, summary))
    except Exception as e:
        logger.error("Proposer run_agent raised: %s", e, exc_info=True)
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": str(e),
        }

    if result.error is not None:
        logger.warning("Proposer terminated with agent error: %s", result.error)
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": str(result.error),
        }

    proposal = result.parsed
    if proposal is None:
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": "proposer returned no parsed output",
        }

    payload = proposal.model_dump()
    payload["target_summary_id"] = summary["id"]
    payload["source_entry_id"] = entry["id"]
    payload["match_score"] = summary.get("score", 0)
    payload["match_reason"] = summary.get("match_reason", "")
    return payload


async def generate_all_proposals(
    entry: dict[str, Any],
    store: SqliteStore,
    retriever: DenseRetriever,
    model: str = DEFAULT_MODEL,
    max_proposals: int | None = None,
) -> list[dict[str, Any]]:
    """Rank related summaries and produce a proposal for each.

    Skips proposals the agent marked as ``no_updates`` or that failed;
    logs a warning for each failure.
    """
    related = await identify_related_summaries(
        entry, store, retriever, max_results=max_proposals
    )

    if not related:
        logger.info("No related summaries found for %s", entry["id"])
        return []

    proposals: list[dict[str, Any]] = []
    for summary in related:
        logger.info(
            "Generating proposal for %s (score: %.2f)",
            summary["id"],
            summary.get("score", 0),
        )
        proposal = await propose_updates(entry, summary, model)

        if proposal.get("error"):
            logger.warning(
                "Error generating proposal for %s: %s",
                summary["id"],
                proposal["error"],
            )
            continue
        if proposal.get("no_updates"):
            continue
        proposals.append(proposal)

    logger.info("Generated %d proposals for %s", len(proposals), entry["id"])
    return proposals
