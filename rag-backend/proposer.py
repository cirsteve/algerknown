"""
Algerknown RAG - Proposer

Update proposal generation for ingest mode.
Identifies related summaries and proposes structured updates.
"""

import anthropic
import json
import os
import logging
from typing import Optional

from vectorstore import VectorStore

logger = logging.getLogger(__name__)


def get_anthropic_client() -> anthropic.Anthropic:
    """Get configured Anthropic client."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or api_key.startswith("sk-ant-..."):
        raise ValueError("ANTHROPIC_API_KEY not configured")
    return anthropic.Anthropic(api_key=api_key)


def identify_related_summaries(
    entry: dict,
    vector_store: VectorStore,
    max_results: int = 5
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
        max_results: Maximum number of summaries to return
        
    Returns:
        List of related summaries sorted by relevance score
    """
    all_summaries = vector_store.get_summaries()
    
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
    similar = vector_store.query(
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


def propose_updates(
    entry: dict,
    summary: dict,
    model: str = "claude-sonnet-4-20250514"
) -> dict:
    """
    Generate proposed updates for a summary based on a new entry.
    
    Args:
        entry: The new entry document
        summary: The target summary document
        model: Claude model to use
        
    Returns:
        Proposal dict with structured updates
    """
    client = get_anthropic_client()
    
    prompt = f"""You are helping maintain a personal knowledge base. A new entry has been added, and you need to propose updates to a related summary.

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

    try:
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        
        text = response.content[0].text.strip()
        
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
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM response: {e}")
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": "Failed to parse LLM response",
            "raw_response": response.content[0].text if response else None
        }
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        return {
            "target_summary_id": summary["id"],
            "source_entry_id": entry["id"],
            "error": str(e)
        }


def generate_all_proposals(
    entry: dict,
    vector_store: VectorStore,
    model: str = "claude-sonnet-4-20250514"
) -> list[dict]:
    """
    Generate update proposals for all related summaries.
    
    Args:
        entry: The new entry document
        vector_store: VectorStore instance
        model: Claude model to use
        
    Returns:
        List of proposal dicts (excluding no_updates)
    """
    related = identify_related_summaries(entry, vector_store)
    
    if not related:
        logger.info(f"No related summaries found for {entry['id']}")
        return []
    
    proposals = []
    for summary in related:
        logger.info(f"Generating proposal for {summary['id']} (score: {summary.get('score', 0):.2f})")
        proposal = propose_updates(entry, summary, model)
        
        # Only include if there are actual updates
        if not proposal.get("no_updates") and not proposal.get("error"):
            proposals.append(proposal)
        elif proposal.get("error"):
            logger.warning(f"Error generating proposal for {summary['id']}: {proposal.get('error')}")
    
    logger.info(f"Generated {len(proposals)} proposals for {entry['id']}")
    return proposals
