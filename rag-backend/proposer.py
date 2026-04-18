"""
Algerknown RAG - Proposer

Prompt building and response parsing for update proposal generation.
Identifies related summaries and builds prompts for proposing structured updates.
"""

import json
import os
import logging

from vectorstore import VectorStore

logger = logging.getLogger(__name__)

# Default max proposals (configurable via MAX_PROPOSALS env var)
DEFAULT_MAX_PROPOSALS = int(os.getenv("MAX_PROPOSALS", "5"))


async def identify_related_summaries(
    entry: dict,
    vector_store: VectorStore,
    max_results: int | None = None
) -> list[dict]:
    """
    Find summaries that should be updated based on a new entry.

    Uses a combination of:
    1. Explicit links in the entry
    2. Semantic similarity search
    3. Tag/topic overlap scoring

    Args:
        entry: The new entry document
        vector_store: VectorStore instance
        max_results: Maximum number of summaries to return (defaults to MAX_PROPOSALS env var or 5)

    Returns:
        List of related summaries sorted by relevance score
    """
    if max_results is None:
        max_results = DEFAULT_MAX_PROPOSALS

    all_summaries = await vector_store.get_summaries()

    if not all_summaries:
        logger.warning("No summaries found in vector store")
        return []

    candidates = {}  # id -> {doc, score}

    # 1. Check explicit links in entry (highest priority)
    raw_entry = entry.get("raw", {})
    for link in raw_entry.get("links", []):
        link_id = link.get("id", "")
        for summary in all_summaries:
            if summary["id"] == link_id:
                candidates[link_id] = {
                    **summary,
                    "score": 1.0,
                    "match_reason": "explicit_link"
                }
                break

    # 2. Semantic similarity search
    similar = await vector_store.query(
        entry["content"],
        n_results=10,
        where={"type": "summary"}
    )

    for i, doc in enumerate(similar):
        doc_id = doc["id"]
        if doc_id not in candidates:
            # Score decays with rank
            score = 0.8 - (i * 0.05)
            candidates[doc_id] = {
                **doc,
                "score": score,
                "match_reason": "semantic_similarity"
            }

    # 3. Tag/topic overlap boosting
    entry_metadata = entry.get("metadata", {})
    entry_tags = set(entry_metadata.get("tags", "").split(",")) if entry_metadata.get("tags") else set()
    entry_topic = entry_metadata.get("topic", "")

    for summary in all_summaries:
        s_id = summary["id"]
        s_metadata = summary.get("metadata", {})

        # Skip if already top priority
        if s_id in candidates and candidates[s_id]["score"] >= 1.0:
            continue

        score_boost = 0

        # Topic match
        if entry_topic and s_metadata.get("topic") == entry_topic:
            score_boost += 0.3

        # Tag overlap
        s_tags = set(s_metadata.get("tags", "").split(",")) if s_metadata.get("tags") else set()
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
                    "match_reason": "tag_overlap"
                }

    # Sort by score and return top results
    sorted_candidates = sorted(
        candidates.values(),
        key=lambda x: x["score"],
        reverse=True
    )

    return sorted_candidates[:max_results]


def build_proposal_prompt(entry: dict, summary: dict) -> str:
    """
    Build the proposal prompt for a single entry-summary pair.

    Args:
        entry: The new entry document
        summary: The target summary document

    Returns:
        Prompt string for the LLM.
    """
    return f"""You are helping maintain a personal knowledge base. A new entry has been added, and you need to propose updates to a related summary.

<new_entry>
ID: {entry['id']}
Type: {entry.get('metadata', {}).get('type', 'entry')}
Topic: {entry.get('metadata', {}).get('topic', '')}

{entry['content']}
</new_entry>

<existing_summary>
ID: {summary['id']}
Topic: {summary.get('metadata', {}).get('topic', '')}

{summary['content']}
</existing_summary>

Based on the new entry, propose updates to the summary. Return a JSON object with these optional fields:

- "new_learnings": Array of {{"insight": "...", "context": "...", "relevance": ["{entry['id']}"]}} objects to add
- "new_decisions": Array of {{"decision": "...", "rationale": "...", "date": "YYYY-MM-DD"}} objects to add
- "new_open_questions": Array of question strings to add
- "new_links": Array of {{"id": "{entry['id']}", "relationship": "informs|depends_on|relates_to", "notes": "..."}} objects to add
- "rationale": Why these updates are relevant

Rules:
1. Only include fields where you have meaningful additions
2. Do NOT duplicate content that already exists in the summary
3. Extract specific, actionable insights from the entry
4. If the entry doesn't warrant any updates to this summary, return {{"no_updates": true, "rationale": "..."}}
5. Keep learnings concise but informative

Return only valid JSON, no markdown code blocks:"""


def parse_proposal_response(text: str, summary: dict, entry: dict) -> dict:
    """
    Parse the LLM response text into a proposal dict.

    Handles markdown code blocks and injects metadata
    (target_summary_id, source_entry_id, match_score, match_reason).

    Args:
        text: Raw LLM response text
        summary: The target summary document (for metadata)
        entry: The source entry document (for metadata)

    Returns:
        Proposal dict with structured updates and metadata.

    Raises:
        json.JSONDecodeError: If the response cannot be parsed as JSON.
    """
    text = text.strip()

    # Handle potential markdown code blocks
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    proposal = json.loads(text.strip())
    proposal["target_summary_id"] = summary["id"]
    proposal["source_entry_id"] = entry["id"]
    proposal["match_score"] = summary.get("score", 0)
    proposal["match_reason"] = summary.get("match_reason", "")

    return proposal
