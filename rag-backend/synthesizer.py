"""
Algerknown RAG - Synthesizer

Prompt building for query synthesis mode. Takes retrieved entries and builds
prompts for generating synthesized answers with citations.
"""

import logging

from jig import LLMClient, CompletionParams, Message, Role

logger = logging.getLogger(__name__)


def build_synthesis_prompt(
    query: str,
    retrieved_entries: list[dict],
    max_context_tokens: int = 12000,
) -> tuple[str, list[str]]:
    """
    Build the synthesis prompt and compute which sources fit in context.

    Args:
        query: User's natural language query
        retrieved_entries: List of retrieved documents with content and metadata
        max_context_tokens: Maximum tokens for context (rough estimate)

    Returns:
        Tuple of (prompt_text, source_ids) where source_ids only includes
        entries that fit within the context window.
    """
    # Format retrieved entries for context, respecting token limit
    context_parts = []
    total_chars = 0
    max_chars = max_context_tokens * 4  # Rough char-to-token ratio

    for entry in retrieved_entries:
        topic = entry.get("metadata", {}).get("topic", "")
        doc_type = entry.get("metadata", {}).get("type", "entry")

        part = (
            f'<document id="{entry["id"]}" type="{doc_type}" topic="{topic}">\n'
            f'{entry["content"]}\n'
            f'</document>'
        )

        if total_chars + len(part) > max_chars:
            logger.warning(f"Context truncated at {len(context_parts)} entries")
            break

        context_parts.append(part)
        total_chars += len(part)

    context = "\n\n".join(context_parts)
    source_ids = [e["id"] for e in retrieved_entries[:len(context_parts)]]

    prompt = f"""You are a knowledge assistant helping query a personal knowledge base about ZK proofs, privacy, cryptography, and related topics.

Based on the retrieved documents below, answer the user's query.

Rules:
- Synthesize information across documents when relevant
- Cite specific document IDs when making claims using this format: [document-id]
- If the documents don't contain relevant information, say so clearly
- Be concise and direct
- Prioritize learnings and decisions from the documents
- If there are open questions related to the query, mention them

<retrieved_documents>
{context}
</retrieved_documents>

<query>{query}</query>

Provide a synthesized answer with citations:"""

    return prompt, source_ids


def build_followup_system_prompt(retrieved_entries: list[dict]) -> str:
    """
    Build the system prompt for follow-up queries.

    Args:
        retrieved_entries: Retrieved documents (limited to first 10)

    Returns:
        System prompt string with embedded document context.
    """
    context_parts = []
    for entry in retrieved_entries[:10]:
        topic = entry.get("metadata", {}).get("topic", "")
        part = (
            f'<document id="{entry["id"]}" topic="{topic}">\n'
            f'{entry["content"]}\n'
            f'</document>'
        )
        context_parts.append(part)

    context = "\n\n".join(context_parts)

    return f"""You are a knowledge assistant helping query a personal knowledge base about ZK proofs, privacy, cryptography, and related topics.

You have access to these retrieved documents:

<retrieved_documents>
{context}
</retrieved_documents>

Rules:
- Synthesize information across documents when relevant
- Cite specific document IDs when making claims: [document-id]
- If the documents don't contain relevant information, say so
- Be concise and direct"""


async def synthesize_with_followup(
    query: str,
    retrieved_entries: list[dict],
    llm_client: LLMClient,
    conversation_history: list[dict] = None,
    model: str = "claude-sonnet-4-20250514",
) -> dict:
    """
    Synthesize with conversation context for follow-up questions.

    Args:
        query: Current user query
        retrieved_entries: Retrieved documents
        llm_client: jig LLMClient instance
        conversation_history: List of previous {role, content} messages
        model: Claude model to use

    Returns:
        Dict with answer and sources
    """
    system_prompt = build_followup_system_prompt(retrieved_entries)

    messages = []
    if conversation_history:
        for msg in conversation_history:
            role = Role.USER if msg["role"] == "user" else Role.ASSISTANT
            messages.append(Message(role=role, content=msg["content"]))
    messages.append(Message(role=Role.USER, content=query))

    try:
        response = await llm_client.complete(CompletionParams(
            messages=messages,
            system=system_prompt,
            max_tokens=1024,
        ))

        return {
            "answer": response.content,
            "sources": [e["id"] for e in retrieved_entries],
        }

    except Exception as e:
        logger.error(f"LLM error in follow-up synthesis: {e}")
        return {
            "answer": f"Error: {str(e)}",
            "sources": [],
            "error": str(e),
        }
