"""
Algerknown RAG - Synthesizer

LLM synthesis for query mode - takes retrieved entries and generates
synthesized answers with citations.
"""

import anthropic
import os
import logging

logger = logging.getLogger(__name__)


def get_anthropic_client() -> anthropic.Anthropic:
    """Get configured Anthropic client."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or api_key.startswith("sk-ant-..."):
        raise ValueError("ANTHROPIC_API_KEY not configured")
    return anthropic.Anthropic(api_key=api_key)


def synthesize_answer(
    query: str, 
    retrieved_entries: list[dict],
    model: str = "claude-sonnet-4-20250514",
    max_context_tokens: int = 12000
) -> dict:
    """
    Synthesize an answer from retrieved entries.
    
    Args:
        query: User's natural language query
        retrieved_entries: List of retrieved documents with content and metadata
        model: Claude model to use
        max_context_tokens: Maximum tokens for context (rough estimate)
        
    Returns:
        Dict with 'answer' and 'sources' fields
    """
    client = get_anthropic_client()
    
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

    try:
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        
        answer = response.content[0].text
        
        return {
            "answer": answer,
            "sources": [e["id"] for e in retrieved_entries[:len(context_parts)]],
            "model": model,
        }
        
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        return {
            "answer": f"Error generating answer: {str(e)}",
            "sources": [],
            "error": str(e),
        }


def synthesize_with_followup(
    query: str,
    retrieved_entries: list[dict],
    conversation_history: list[dict] = None,
    model: str = "claude-sonnet-4-20250514"
) -> dict:
    """
    Synthesize with conversation context for follow-up questions.
    
    Args:
        query: Current user query
        retrieved_entries: Retrieved documents
        conversation_history: List of previous {role, content} messages
        model: Claude model to use
        
    Returns:
        Dict with answer and sources
    """
    client = get_anthropic_client()
    
    # Build context
    context_parts = []
    for entry in retrieved_entries[:10]:  # Limit for follow-ups
        topic = entry.get("metadata", {}).get("topic", "")
        part = (
            f'<document id="{entry["id"]}" topic="{topic}">\n'
            f'{entry["content"]}\n'
            f'</document>'
        )
        context_parts.append(part)
        
    context = "\n\n".join(context_parts)
    
    system_prompt = f"""You are a knowledge assistant helping query a personal knowledge base about ZK proofs, privacy, cryptography, and related topics.

You have access to these retrieved documents:

<retrieved_documents>
{context}
</retrieved_documents>

Rules:
- Synthesize information across documents when relevant
- Cite specific document IDs when making claims: [document-id]
- If the documents don't contain relevant information, say so
- Be concise and direct"""

    messages = []
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": query})
    
    try:
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages
        )
        
        return {
            "answer": response.content[0].text,
            "sources": [e["id"] for e in retrieved_entries],
        }
        
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        return {
            "answer": f"Error: {str(e)}",
            "sources": [],
            "error": str(e),
        }
