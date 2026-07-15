"""
Algerknown RAG - Writer

Apply approved updates to YAML files while preserving formatting.
"""

from ruamel.yaml import YAML
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

yaml = YAML()
yaml.preserve_quotes = True
yaml.indent(mapping=2, sequence=4, offset=2)


def validate_proposal(proposal: dict) -> tuple[bool, Optional[str]]:
    """
    Validate proposal structure before applying.
    
    Args:
        proposal: Proposal dict to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not proposal.get("target_summary_id"):
        return False, "Missing target_summary_id"
        
    if not proposal.get("source_entry_id"):
        return False, "Missing source_entry_id"
    
    # Validate new_learnings structure
    new_learnings = proposal.get("new_learnings")
    if new_learnings is not None:
        if not isinstance(new_learnings, list):
            return False, "new_learnings is not a list"
        for i, learning in enumerate(new_learnings):
            if not isinstance(learning, dict):
                return False, f"new_learnings[{i}] is not a dict"
            if "insight" not in learning:
                return False, f"new_learnings[{i}] missing 'insight' field"
            # Validate relevance field if present
            if "relevance" in learning:
                if not isinstance(learning["relevance"], list):
                    return False, f"new_learnings[{i}] 'relevance' must be a list"
                for j, rel in enumerate(learning["relevance"]):
                    if not isinstance(rel, str):
                        return False, f"new_learnings[{i}]['relevance'][{j}] must be a string"
    
    # Validate new_decisions structure
    new_decisions = proposal.get("new_decisions")
    if new_decisions is not None:
        if not isinstance(new_decisions, list):
            return False, "new_decisions is not a list"
        for i, decision in enumerate(new_decisions):
            if not isinstance(decision, dict):
                return False, f"new_decisions[{i}] is not a dict"
            if "decision" not in decision:
                return False, f"new_decisions[{i}] missing 'decision' field"
    
    # Validate new_open_questions structure
    new_questions = proposal.get("new_open_questions")
    if new_questions is not None:
        if not isinstance(new_questions, list):
            return False, "new_open_questions is not a list"
        for i, question in enumerate(new_questions):
            if not isinstance(question, str):
                return False, f"new_open_questions[{i}] is not a string"
    
    # Validate new_links structure
    new_links = proposal.get("new_links")
    if new_links is not None:
        if not isinstance(new_links, list):
            return False, "new_links is not a list"
        for i, link in enumerate(new_links):
            if not isinstance(link, dict):
                return False, f"new_links[{i}] is not a dict"
            if "id" not in link:
                return False, f"new_links[{i}] missing 'id' field"
    
    return True, None


def find_summary_file(summary_id: str, content_dir: str) -> Optional[Path]:
    """
    Find the YAML file for a summary by ID.
    
    Args:
        summary_id: Summary document ID
        content_dir: Content directory path
        
    Returns:
        Path to the file or None
    """
    content_path = Path(content_dir)
    
    # Check summaries directory first
    summaries_dir = content_path / "summaries"
    if summaries_dir.exists():
        for file in summaries_dir.glob("*.yaml"):
            try:
                with open(file) as f:
                    content = yaml.load(f)
                    if content and content.get("id") == summary_id:
                        return file
            except Exception as e:
                logger.warning(f"Error reading {file}: {e}")
    
    # Also check entries directory (in case type is wrong in metadata)
    entries_dir = content_path / "entries"
    if entries_dir.exists():
        for file in entries_dir.glob("*.yaml"):
            try:
                with open(file) as f:
                    content = yaml.load(f)
                    if content and content.get("id") == summary_id:
                        return file
            except Exception as e:
                logger.warning(f"Error reading {file}: {e}")
    
    return None


def preview_update(proposal: dict, content_dir: str) -> dict:
    """
    Preview what changes would be made without applying them.
    
    Args:
        proposal: Proposal dict
        content_dir: Content directory path
        
    Returns:
        Preview of changes
    """
    is_valid, error = validate_proposal(proposal)
    if not is_valid:
        return {"valid": False, "error": error}
    
    summary_id = proposal["target_summary_id"]
    file_path = find_summary_file(summary_id, content_dir)
    
    if not file_path:
        return {"valid": False, "error": f"Summary file not found: {summary_id}"}
    
    with open(file_path) as f:
        summary = yaml.load(f)
    
    preview = {
        "valid": True,
        "file": str(file_path),
        "summary_id": summary_id,
        "current_learnings_count": len(summary.get("learnings", [])),
        "current_decisions_count": len(summary.get("decisions", [])),
        "current_questions_count": len(summary.get("open_questions", [])),
        "current_links_count": len(summary.get("links", [])),
        "proposed_new_learnings": len(proposal.get("new_learnings", [])),
        "proposed_new_decisions": len(proposal.get("new_decisions", [])),
        "proposed_new_questions": len(proposal.get("new_open_questions", [])),
        "proposed_new_links": len(proposal.get("new_links", [])),
    }
    
    return preview
