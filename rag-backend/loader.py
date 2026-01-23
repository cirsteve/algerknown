"""
Algerknown RAG - Entry Loader

Parses YAML files (entries and summaries) into documents for embedding.
Handles both entry and summary schemas with unified flattening.
"""

from ruamel.yaml import YAML
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

yaml = YAML()
yaml.preserve_quotes = True


def load_content(directory: str) -> list[dict]:
    """
    Load all YAML entries and summaries from a content directory.
    
    Args:
        directory: Path to content directory containing entries/ and summaries/
        
    Returns:
        List of document dicts with id, content, metadata, and raw fields
    """
    documents = []
    content_path = Path(directory)
    
    # Scan both entries and summaries directories
    for subdir in ["entries", "summaries"]:
        subdir_path = content_path / subdir
        if not subdir_path.exists():
            logger.warning(f"Directory not found: {subdir_path}")
            continue
            
        for file in subdir_path.glob("*.yaml"):
            try:
                doc = load_single_file(file)
                if doc:
                    documents.append(doc)
            except Exception as e:
                logger.error(f"Failed to load {file}: {e}")
                
    logger.info(f"Loaded {len(documents)} documents from {directory}")
    return documents


def load_single_file(file_path: Path) -> Optional[dict]:
    """
    Load a single YAML file into a document dict.
    
    Args:
        file_path: Path to the YAML file
        
    Returns:
        Document dict or None if invalid
    """
    with open(file_path) as f:
        entry = yaml.load(f)
        
    if not entry or "id" not in entry:
        logger.warning(f"Skipping {file_path}: missing 'id' field")
        return None
        
    return {
        "id": entry["id"],
        "content": flatten_document(entry),
        "metadata": extract_metadata(entry, file_path),
        "raw": entry,
    }


def extract_metadata(entry: dict, file_path: Path) -> dict:
    """Extract metadata for vector store filtering."""
    metadata = {
        "type": entry.get("type", "entry"),
        "topic": entry.get("topic", ""),
        "status": entry.get("status", ""),
        "file_path": str(file_path),
    }
    
    # Handle tags - ChromaDB requires flat values, so join as string
    tags = entry.get("tags", [])
    if tags:
        metadata["tags"] = ",".join(tags)
    else:
        metadata["tags"] = ""
    
    # Handle dates - entries have 'date', summaries have 'date_range'
    if "date" in entry:
        metadata["date"] = str(entry["date"])
    elif "date_range" in entry:
        metadata["date"] = str(entry["date_range"].get("start", ""))
        
    return metadata


def flatten_document(entry: dict) -> str:
    """
    Convert structured entry/summary to flat text for embedding.
    Handles both entry and summary schemas.
    
    Args:
        entry: Raw YAML document
        
    Returns:
        Flattened text string
    """
    parts = []
    doc_type = entry.get("type", "entry")
    
    # Common fields
    if entry.get("topic"):
        parts.append(f"Topic: {entry['topic']}")
        
    # Summary-specific fields
    if entry.get("summary"):
        parts.append(f"Summary: {entry['summary']}")
        
    # Entry-specific fields
    if entry.get("context"):
        parts.append(f"Context: {entry['context']}")
        
    if entry.get("approach"):
        parts.append(f"Approach: {entry['approach']}")
    
    # Learnings (both types)
    for learning in entry.get("learnings", []):
        insight = learning.get("insight", "")
        context = learning.get("context", "")
        details = learning.get("details", "")
        parts.append(f"Learning: {insight}")
        if context:
            parts.append(f"  Context: {context}")
        if details:
            parts.append(f"  Details: {details}")
    
    # Decisions (both types)
    for decision in entry.get("decisions", []):
        dec = decision.get("decision", "")
        rationale = decision.get("rationale", "")
        parts.append(f"Decision: {dec}")
        if rationale:
            parts.append(f"  Rationale: {rationale}")
    
    # Open questions (both types)
    for question in entry.get("open_questions", []):
        parts.append(f"Open question: {question}")
    
    # Outcome (entry-specific)
    outcome = entry.get("outcome", {})
    if outcome:
        for item in outcome.get("worked", []):
            parts.append(f"Worked: {item}")
        for item in outcome.get("failed", []):
            parts.append(f"Failed: {item}")
        for item in outcome.get("surprised", []):
            parts.append(f"Surprised: {item}")
    
    # Links (both types)
    for link in entry.get("links", []):
        link_id = link.get("id", "")
        relationship = link.get("relationship", "")
        parts.append(f"Link: {link_id} ({relationship})")
    
    return "\n".join(parts)


def get_entry_by_id(documents: list[dict], entry_id: str) -> Optional[dict]:
    """Find a document by ID."""
    for doc in documents:
        if doc["id"] == entry_id:
            return doc
    return None
