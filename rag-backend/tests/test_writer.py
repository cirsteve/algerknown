"""
Tests for the writer module.
"""

import pytest
import tempfile
from pathlib import Path
from ruamel.yaml import YAML

from writer import (
    validate_proposal,
    find_summary_file,
    apply_update,
    preview_update
)


yaml = YAML()
yaml.preserve_quotes = True


SAMPLE_SUMMARY = """
id: "test-summary"
type: "summary"
topic: "Test Summary"
status: "reference"

summary: |
  A test summary for validation.

learnings:
  - insight: "Existing learning"
    context: "Existing context"

decisions:
  - decision: "Existing decision"
    rationale: "Existing rationale"
    date: "2026-01-01"

open_questions:
  - "Existing question?"

links:
  - id: "existing-link"
    relationship: "depends_on"
"""


@pytest.fixture
def temp_content_dir():
    """Create a temporary content directory with sample summary."""
    with tempfile.TemporaryDirectory() as tmpdir:
        summaries_dir = Path(tmpdir) / "summaries"
        summaries_dir.mkdir()
        
        summary_file = summaries_dir / "test-summary.yaml"
        summary_file.write_text(SAMPLE_SUMMARY)
        
        yield tmpdir


class TestValidateProposal:
    """Tests for validate_proposal function."""
    
    def test_valid_proposal(self):
        """Should accept valid proposal."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "New insight", "context": "Context"}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is True
        assert error is None
    
    def test_missing_target_summary_id(self):
        """Should reject proposal without target_summary_id."""
        proposal = {
            "source_entry_id": "test-entry"
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "target_summary_id" in error
    
    def test_missing_source_entry_id(self):
        """Should reject proposal without source_entry_id."""
        proposal = {
            "target_summary_id": "test-summary"
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "source_entry_id" in error
    
    def test_invalid_learning_structure(self):
        """Should reject learning without insight field."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"context": "Missing insight field"}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "insight" in error
    
    def test_invalid_decision_structure(self):
        """Should reject decision without decision field."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_decisions": [
                {"rationale": "Missing decision field"}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "decision" in error
    
    def test_invalid_question_type(self):
        """Should reject non-string questions."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_open_questions": [
                {"question": "This should be a string, not a dict"}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "string" in error
    
    def test_invalid_link_structure(self):
        """Should reject link without id field."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_links": [
                {"relationship": "depends_on"}  # Missing id
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "id" in error


class TestFindSummaryFile:
    """Tests for find_summary_file function."""
    
    def test_find_existing_summary(self, temp_content_dir):
        """Should find summary file by ID."""
        file_path = find_summary_file("test-summary", temp_content_dir)
        
        assert file_path is not None
        assert file_path.name == "test-summary.yaml"
    
    def test_find_nonexistent_summary(self, temp_content_dir):
        """Should return None for non-existent summary."""
        file_path = find_summary_file("nonexistent", temp_content_dir)
        
        assert file_path is None


class TestApplyUpdate:
    """Tests for apply_update function."""
    
    def test_apply_new_learning(self, temp_content_dir):
        """Should add new learning to summary."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "Brand new insight", "context": "New context"}
            ]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        assert len(result["changes"]) == 1
        
        # Verify file was updated
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        with open(file_path) as f:
            updated = yaml.load(f)
        
        assert len(updated["learnings"]) == 2
        assert updated["learnings"][1]["insight"] == "Brand new insight"
        # Should have added relevance
        assert "test-entry" in updated["learnings"][1]["relevance"]
    
    def test_apply_new_decision(self, temp_content_dir):
        """Should add new decision to summary."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_decisions": [
                {"decision": "New decision", "rationale": "New rationale"}
            ]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        
        # Verify file was updated
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        with open(file_path) as f:
            updated = yaml.load(f)
        
        assert len(updated["decisions"]) == 2
        # Should have added date
        assert "date" in updated["decisions"][1]
    
    def test_apply_new_question(self, temp_content_dir):
        """Should add new open question to summary."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_open_questions": ["New question?"]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        with open(file_path) as f:
            updated = yaml.load(f)
        
        assert "New question?" in updated["open_questions"]
    
    def test_apply_new_link(self, temp_content_dir):
        """Should add new link to summary."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_links": [
                {"id": "new-link", "relationship": "informs"}
            ]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        with open(file_path) as f:
            updated = yaml.load(f)
        
        link_ids = [l["id"] for l in updated["links"]]
        assert "new-link" in link_ids
    
    def test_skip_duplicate_learning(self, temp_content_dir):
        """Should not add duplicate learning."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "Existing learning", "context": "Different context"}
            ]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        assert len(result["changes"]) == 0  # No new changes
        
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        with open(file_path) as f:
            updated = yaml.load(f)
        
        # Still only one learning
        assert len(updated["learnings"]) == 1
    
    def test_skip_duplicate_question(self, temp_content_dir):
        """Should not add duplicate question."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_open_questions": ["Existing question?"]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        assert len(result["changes"]) == 0
    
    def test_skip_duplicate_link(self, temp_content_dir):
        """Should not add duplicate link."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_links": [
                {"id": "existing-link", "relationship": "informs"}
            ]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is True
        assert len(result["changes"]) == 0
    
    def test_apply_to_nonexistent_summary(self, temp_content_dir):
        """Should fail for non-existent summary."""
        proposal = {
            "target_summary_id": "nonexistent",
            "source_entry_id": "test-entry",
            "new_learnings": [{"insight": "Test", "context": "Test"}]
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is False
        assert "not found" in result["error"]
    
    def test_apply_invalid_proposal(self, temp_content_dir):
        """Should fail for invalid proposal structure."""
        proposal = {
            "target_summary_id": "test-summary"
            # Missing source_entry_id
        }
        
        result = apply_update(proposal, temp_content_dir)
        
        assert result["success"] is False


class TestPreviewUpdate:
    """Tests for preview_update function."""
    
    def test_preview_valid_proposal(self, temp_content_dir):
        """Should return preview of changes."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [{"insight": "New", "context": "New"}],
            "new_decisions": [{"decision": "New", "rationale": "New"}]
        }
        
        preview = preview_update(proposal, temp_content_dir)
        
        assert preview["valid"] is True
        assert preview["current_learnings_count"] == 1
        assert preview["proposed_new_learnings"] == 1
        assert preview["proposed_new_decisions"] == 1
    
    def test_preview_invalid_proposal(self, temp_content_dir):
        """Should return invalid for bad proposal."""
        proposal = {}
        
        preview = preview_update(proposal, temp_content_dir)
        
        assert preview["valid"] is False
