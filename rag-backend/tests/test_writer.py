"""
Tests for the writer module.
"""

import pytest
import tempfile
from pathlib import Path
from ruamel.yaml import YAML

import inspect

import writer
from writer import (
    validate_proposal,
    find_summary_file,
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
    
    def test_invalid_learning_relevance_not_list(self):
        """Should reject learning where relevance is not a list."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "Some insight", "relevance": "not-a-list"}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "relevance" in error
        assert "must be a list" in error
    
    def test_invalid_learning_relevance_non_string_items(self):
        """Should reject learning where relevance contains non-strings."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "Some insight", "relevance": ["valid-id", 123]}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is False
        assert "relevance" in error
        assert "must be a string" in error
    
    def test_valid_learning_with_relevance_list(self):
        """Should accept learning with valid relevance list."""
        proposal = {
            "target_summary_id": "test-summary",
            "source_entry_id": "test-entry",
            "new_learnings": [
                {"insight": "Some insight", "relevance": ["entry-1", "entry-2"]}
            ]
        }
        
        is_valid, error = validate_proposal(proposal)
        
        assert is_valid is True
        assert error is None
    
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


class TestNoFilesystemWrites:
    """apply_update was removed along with all file-writing behavior; the
    module must now perform only pure conversion/validation and read-only
    lookups (find_summary_file, preview_update)."""

    def test_apply_update_no_longer_exists(self):
        assert not hasattr(writer, "apply_update")

    def test_module_source_contains_no_write_mode_file_opens(self):
        source = inspect.getsource(writer)
        assert 'open(file_path, "w")' not in source
        assert "open(file_path, 'w')" not in source
        assert "yaml.dump(" not in source

    def test_preview_and_find_leave_the_summary_file_untouched(self, temp_content_dir):
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        before = file_path.read_text()

        find_summary_file("test-summary", temp_content_dir)
        preview_update(
            {
                "target_summary_id": "test-summary",
                "source_entry_id": "test-entry",
                "new_learnings": [{"insight": "New", "context": "New"}],
            },
            temp_content_dir,
        )

        assert file_path.read_text() == before


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
