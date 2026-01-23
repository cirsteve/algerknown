"""
Tests for the loader module.
"""

import pytest
from pathlib import Path
import tempfile
import os

from loader import (
    load_content,
    load_single_file,
    flatten_document,
    extract_metadata,
    get_entry_by_id
)


# Sample YAML content for testing
SAMPLE_ENTRY = """
id: "test-entry-001"
type: "entry"
date: "2026-01-20"
topic: "Test Entry Topic"
status: "active"

tags:
  - test
  - example

context: |
  This is test context for the entry.

approach: |
  This is the approach taken.

outcome:
  worked:
    - "First thing that worked"
    - "Second thing that worked"
  failed:
    - "Something that failed"
  surprised:
    - "Something surprising"

learnings:
  - insight: "Test insight one"
    context: "Context for insight one"
    details: "Detailed information"
  - insight: "Test insight two"
    context: "Context for insight two"

decisions:
  - decision: "Test decision"
    rationale: "Rationale for the decision"

open_questions:
  - "First open question?"
  - "Second open question?"

links:
  - id: "related-entry"
    relationship: "depends_on"
"""

SAMPLE_SUMMARY = """
id: "test-summary-001"
type: "summary"
topic: "Test Summary Topic"
status: "reference"

summary: |
  This is a summary document that aggregates learnings.

date_range:
  start: "2026-01-01"

tags:
  - summary
  - test

learnings:
  - insight: "Summary learning one"
    context: "Summary context"
    relevance:
      - "test-entry-001"

decisions:
  - decision: "Summary decision"
    rationale: "Summary rationale"
    date: "2026-01-15"

open_questions:
  - "Summary open question?"

links:
  - id: "test-entry-001"
    relationship: "informs"
"""


@pytest.fixture
def temp_content_dir():
    """Create a temporary content directory with sample files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create entries directory
        entries_dir = Path(tmpdir) / "entries"
        entries_dir.mkdir()
        
        # Create summaries directory
        summaries_dir = Path(tmpdir) / "summaries"
        summaries_dir.mkdir()
        
        # Write sample entry
        entry_file = entries_dir / "test-entry.yaml"
        entry_file.write_text(SAMPLE_ENTRY)
        
        # Write sample summary
        summary_file = summaries_dir / "test-summary.yaml"
        summary_file.write_text(SAMPLE_SUMMARY)
        
        yield tmpdir


class TestLoadContent:
    """Tests for load_content function."""
    
    def test_load_content_finds_all_files(self, temp_content_dir):
        """Should load both entries and summaries."""
        documents = load_content(temp_content_dir)
        
        assert len(documents) == 2
        ids = [d["id"] for d in documents]
        assert "test-entry-001" in ids
        assert "test-summary-001" in ids
    
    def test_load_content_empty_directory(self):
        """Should handle empty directories gracefully."""
        with tempfile.TemporaryDirectory() as tmpdir:
            documents = load_content(tmpdir)
            assert documents == []
    
    def test_load_content_missing_directory(self):
        """Should handle missing directories gracefully."""
        documents = load_content("/nonexistent/path")
        assert documents == []


class TestLoadSingleFile:
    """Tests for load_single_file function."""
    
    def test_load_entry_file(self, temp_content_dir):
        """Should load and parse an entry file."""
        file_path = Path(temp_content_dir) / "entries" / "test-entry.yaml"
        doc = load_single_file(file_path)
        
        assert doc is not None
        assert doc["id"] == "test-entry-001"
        assert "content" in doc
        assert "metadata" in doc
        assert "raw" in doc
    
    def test_load_summary_file(self, temp_content_dir):
        """Should load and parse a summary file."""
        file_path = Path(temp_content_dir) / "summaries" / "test-summary.yaml"
        doc = load_single_file(file_path)
        
        assert doc is not None
        assert doc["id"] == "test-summary-001"
        assert doc["metadata"]["type"] == "summary"
    
    def test_load_file_missing_id(self, temp_content_dir):
        """Should return None for files without id."""
        file_path = Path(temp_content_dir) / "entries" / "invalid.yaml"
        file_path.write_text("topic: No ID here")
        
        doc = load_single_file(file_path)
        assert doc is None


class TestFlattenDocument:
    """Tests for flatten_document function."""
    
    def test_flatten_entry(self):
        """Should flatten entry fields correctly."""
        from ruamel.yaml import YAML
        yaml = YAML()
        entry = yaml.load(SAMPLE_ENTRY)
        
        flattened = flatten_document(entry)
        
        assert "Topic: Test Entry Topic" in flattened
        assert "Context:" in flattened
        assert "Approach:" in flattened
        assert "Learning: Test insight one" in flattened
        assert "Decision: Test decision" in flattened
        assert "Open question: First open question?" in flattened
        assert "Worked: First thing that worked" in flattened
        assert "Failed: Something that failed" in flattened
        assert "Surprised: Something surprising" in flattened
        assert "Link: related-entry" in flattened
    
    def test_flatten_summary(self):
        """Should flatten summary fields correctly."""
        from ruamel.yaml import YAML
        yaml = YAML()
        summary = yaml.load(SAMPLE_SUMMARY)
        
        flattened = flatten_document(summary)
        
        assert "Topic: Test Summary Topic" in flattened
        assert "Summary:" in flattened
        assert "Learning: Summary learning one" in flattened
        assert "Decision: Summary decision" in flattened
    
    def test_flatten_minimal_document(self):
        """Should handle minimal documents."""
        doc = {"id": "minimal", "topic": "Minimal"}
        flattened = flatten_document(doc)
        
        assert "Topic: Minimal" in flattened


class TestExtractMetadata:
    """Tests for extract_metadata function."""
    
    def test_extract_entry_metadata(self, temp_content_dir):
        """Should extract metadata from entry."""
        from ruamel.yaml import YAML
        yaml = YAML()
        entry = yaml.load(SAMPLE_ENTRY)
        file_path = Path(temp_content_dir) / "entries" / "test.yaml"
        
        metadata = extract_metadata(entry, file_path)
        
        assert metadata["type"] == "entry"
        assert metadata["topic"] == "Test Entry Topic"
        assert metadata["status"] == "active"
        assert "test" in metadata["tags"]
        assert metadata["date"] == "2026-01-20"
    
    def test_extract_summary_metadata(self, temp_content_dir):
        """Should extract metadata from summary with date_range."""
        from ruamel.yaml import YAML
        yaml = YAML()
        summary = yaml.load(SAMPLE_SUMMARY)
        file_path = Path(temp_content_dir) / "summaries" / "test.yaml"
        
        metadata = extract_metadata(summary, file_path)
        
        assert metadata["type"] == "summary"
        assert metadata["date"] == "2026-01-01"  # From date_range.start


class TestGetEntryById:
    """Tests for get_entry_by_id function."""
    
    def test_find_existing_entry(self, temp_content_dir):
        """Should find entry by ID."""
        documents = load_content(temp_content_dir)
        
        entry = get_entry_by_id(documents, "test-entry-001")
        
        assert entry is not None
        assert entry["id"] == "test-entry-001"
    
    def test_not_found(self, temp_content_dir):
        """Should return None for non-existent ID."""
        documents = load_content(temp_content_dir)
        
        entry = get_entry_by_id(documents, "nonexistent")
        
        assert entry is None
