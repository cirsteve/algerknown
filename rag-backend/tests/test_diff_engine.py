"""
Tests for the diff engine module.
"""

import pytest
import tempfile
from pathlib import Path
from datetime import datetime

from diff_engine import (
    flatten_to_nodes,
    get_node_value,
    compute_diff,
    Changelog,
    VersionCache,
    diff_and_log,
    ChangeType,
)


class TestFlattenToNodes:
    """Tests for flatten_to_nodes function."""

    def test_simple_dict(self):
        """Should flatten simple dict to paths."""
        data = {"foo": "bar", "baz": 123}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"foo": "bar", "baz": 123}

    def test_nested_dict(self):
        """Should flatten nested dict with dot notation."""
        data = {"foo": {"bar": "value", "baz": 456}}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"foo.bar": "value", "foo.baz": 456}

    def test_array(self):
        """Should flatten array with bracket notation."""
        data = {"items": ["a", "b", "c"]}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"items[0]": "a", "items[1]": "b", "items[2]": "c"}

    def test_nested_array_of_dicts(self):
        """Should flatten array of dicts."""
        data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"users[0].name": "Alice", "users[1].name": "Bob"}

    def test_deeply_nested(self):
        """Should handle deeply nested structures."""
        data = {"a": {"b": {"c": {"d": "deep"}}}}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"a.b.c.d": "deep"}

    def test_empty_dict(self):
        """Should handle empty dict."""
        data = {}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {}

    def test_empty_nested_values(self):
        """Should preserve empty dicts/arrays as leaf values."""
        data = {"empty_dict": {}, "empty_list": []}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"empty_dict": {}, "empty_list": []}

    def test_null_values(self):
        """Should handle null values."""
        data = {"foo": None, "bar": "value"}
        nodes = flatten_to_nodes(data)
        
        assert nodes == {"foo": None, "bar": "value"}


class TestGetNodeValue:
    """Tests for get_node_value function."""

    def test_simple_path(self):
        """Should get value at simple path."""
        data = {"foo": "bar"}
        found, value = get_node_value(data, "foo")
        
        assert found is True
        assert value == "bar"

    def test_nested_path(self):
        """Should get value at nested path."""
        data = {"foo": {"bar": {"baz": 123}}}
        found, value = get_node_value(data, "foo.bar.baz")
        
        assert found is True
        assert value == 123

    def test_array_index(self):
        """Should get value at array index."""
        data = {"items": ["a", "b", "c"]}
        found, value = get_node_value(data, "items[1]")
        
        assert found is True
        assert value == "b"

    def test_nested_array(self):
        """Should get value in nested array."""
        data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
        found, value = get_node_value(data, "users[1].name")
        
        assert found is True
        assert value == "Bob"

    def test_missing_path(self):
        """Should return not found for missing path."""
        data = {"foo": "bar"}
        found, value = get_node_value(data, "baz")
        
        assert found is False
        assert value is None

    def test_out_of_bounds_index(self):
        """Should return not found for out of bounds index."""
        data = {"items": ["a"]}
        found, value = get_node_value(data, "items[5]")
        
        assert found is False
        assert value is None

    def test_empty_path(self):
        """Should return whole data for empty path."""
        data = {"foo": "bar"}
        found, value = get_node_value(data, "")
        
        assert found is True
        assert value == data


class TestComputeDiff:
    """Tests for compute_diff function."""

    def test_new_document(self):
        """Should detect all fields as added for new document."""
        new_data = {"id": "test", "topic": "Test Topic"}
        changes = compute_diff(None, new_data, "test.yaml")
        
        assert len(changes) == 2
        assert all(c["type"] == ChangeType.ADDED for c in changes)
        paths = {c["path"] for c in changes}
        assert paths == {"id", "topic"}

    def test_field_added(self):
        """Should detect added field."""
        old_data = {"id": "test"}
        new_data = {"id": "test", "topic": "New Topic"}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["type"] == ChangeType.ADDED
        assert changes[0]["path"] == "topic"
        assert changes[0]["value"] == "New Topic"

    def test_field_removed(self):
        """Should detect removed field."""
        old_data = {"id": "test", "topic": "Topic"}
        new_data = {"id": "test"}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["type"] == ChangeType.REMOVED
        assert changes[0]["path"] == "topic"
        assert changes[0]["old"] == "Topic"

    def test_field_modified(self):
        """Should detect modified field."""
        old_data = {"id": "test", "topic": "Old Topic"}
        new_data = {"id": "test", "topic": "New Topic"}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["type"] == ChangeType.MODIFIED
        assert changes[0]["path"] == "topic"
        assert changes[0]["old"] == "Old Topic"
        assert changes[0]["new"] == "New Topic"

    def test_no_changes(self):
        """Should return empty list when no changes."""
        data = {"id": "test", "topic": "Topic"}
        changes = compute_diff(data.copy(), data.copy(), "test.yaml")
        
        assert len(changes) == 0

    def test_nested_field_added(self):
        """Should detect added nested field."""
        old_data = {"meta": {"a": 1}}
        new_data = {"meta": {"a": 1, "b": 2}}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["path"] == "meta.b"
        assert changes[0]["type"] == ChangeType.ADDED

    def test_array_item_added(self):
        """Should detect added array item."""
        old_data = {"tags": ["a", "b"]}
        new_data = {"tags": ["a", "b", "c"]}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["path"] == "tags[2]"
        assert changes[0]["type"] == ChangeType.ADDED
        assert changes[0]["value"] == "c"

    def test_array_item_modified(self):
        """Should detect modified array item."""
        old_data = {"tags": ["a", "b"]}
        new_data = {"tags": ["a", "B"]}
        changes = compute_diff(old_data, new_data, "test.yaml")
        
        assert len(changes) == 1
        assert changes[0]["path"] == "tags[1]"
        assert changes[0]["type"] == ChangeType.MODIFIED
        assert changes[0]["old"] == "b"
        assert changes[0]["new"] == "B"

    def test_timestamp_format(self):
        """Should include ISO timestamp in changes."""
        timestamp = datetime(2026, 1, 24, 12, 0, 0)
        changes = compute_diff(None, {"id": "test"}, "test.yaml", timestamp)
        
        assert changes[0]["timestamp"] == "2026-01-24T12:00:00Z"

    def test_source_file_included(self):
        """Should include source file in changes."""
        changes = compute_diff(None, {"id": "test"}, "path/to/test.yaml")
        
        assert changes[0]["source"] == "path/to/test.yaml"


class TestChangelog:
    """Tests for Changelog class."""

    def test_create_file(self):
        """Should create changelog file if not exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            assert path.exists()

    def test_append_changes(self):
        """Should append changes to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changes = [
                {"timestamp": "2026-01-24T12:00:00Z", "type": "added", "path": "foo"}
            ]
            changelog.append(changes)
            
            content = path.read_text()
            assert "foo" in content

    def test_read_all(self):
        """Should read all changes from file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changelog.append([
                {"timestamp": "2026-01-24T12:00:00Z", "type": "added", "path": "a"},
                {"timestamp": "2026-01-24T12:01:00Z", "type": "added", "path": "b"},
            ])
            
            all_changes = changelog.read_all()
            assert len(all_changes) == 2

    def test_read_recent(self):
        """Should read recent changes in descending order."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changelog.append([
                {"timestamp": "2026-01-24T10:00:00Z", "type": "added", "path": "old"},
                {"timestamp": "2026-01-24T12:00:00Z", "type": "added", "path": "new"},
            ])
            
            recent = changelog.read_recent(limit=1)
            assert len(recent) == 1
            assert recent[0]["path"] == "new"

    def test_read_by_source(self):
        """Should filter changes by source."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changelog.append([
                {"timestamp": "2026-01-24T12:00:00Z", "source": "a.yaml", "path": "x"},
                {"timestamp": "2026-01-24T12:00:00Z", "source": "b.yaml", "path": "y"},
            ])
            
            filtered = changelog.read_by_source("a.yaml")
            assert len(filtered) == 1
            assert filtered[0]["path"] == "x"

    def test_read_by_path(self):
        """Should filter changes by path prefix."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changelog.append([
                {"timestamp": "2026-01-24T12:00:00Z", "path": "foo.bar"},
                {"timestamp": "2026-01-24T12:00:00Z", "path": "foo.baz"},
                {"timestamp": "2026-01-24T12:00:00Z", "path": "other"},
            ])
            
            filtered = changelog.read_by_path("foo")
            assert len(filtered) == 2

    def test_read_by_type(self):
        """Should filter changes by type."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "changelog.jsonl"
            changelog = Changelog(path)
            
            changelog.append([
                {"timestamp": "2026-01-24T12:00:00Z", "type": "added", "path": "a"},
                {"timestamp": "2026-01-24T12:00:00Z", "type": "modified", "path": "b"},
                {"timestamp": "2026-01-24T12:00:00Z", "type": "added", "path": "c"},
            ])
            
            filtered = changelog.read_by_type("added")
            assert len(filtered) == 2


class TestVersionCache:
    """Tests for VersionCache class."""

    def test_create_directory(self):
        """Should create cache directory if not exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir) / "cache"
            cache = VersionCache(cache_dir)
            
            assert cache_dir.exists()

    def test_get_previous_empty(self):
        """Should return None when no previous version."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = VersionCache(tmpdir)
            
            result = cache.get_previous("nonexistent.yaml")
            assert result is None

    def test_save_and_get(self):
        """Should save and retrieve previous version."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = VersionCache(tmpdir)
            
            data = {"id": "test", "topic": "Test"}
            cache.save_current("entry.yaml", data)
            
            result = cache.get_previous("entry.yaml")
            assert result == data


class TestDiffAndLog:
    """Tests for diff_and_log function."""

    def test_new_document_logged(self):
        """Should log all fields for new document."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
            version_cache = VersionCache(Path(tmpdir) / "cache")
            
            new_data = {"id": "test", "topic": "Topic"}
            changes = diff_and_log("test.yaml", new_data, changelog, version_cache)
            
            assert len(changes) == 2
            assert all(c["type"] == "added" for c in changes)

    def test_subsequent_changes_logged(self):
        """Should log only changed fields on update."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
            version_cache = VersionCache(Path(tmpdir) / "cache")
            
            # First version
            v1 = {"id": "test", "topic": "Topic 1"}
            diff_and_log("test.yaml", v1, changelog, version_cache)
            
            # Second version
            v2 = {"id": "test", "topic": "Topic 2"}
            changes = diff_and_log("test.yaml", v2, changelog, version_cache)
            
            assert len(changes) == 1
            assert changes[0]["type"] == "modified"
            assert changes[0]["path"] == "topic"

    def test_no_changes_not_logged(self):
        """Should not log when no changes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
            version_cache = VersionCache(Path(tmpdir) / "cache")
            
            data = {"id": "test", "topic": "Topic"}
            diff_and_log("test.yaml", data, changelog, version_cache)
            changes = diff_and_log("test.yaml", data.copy(), changelog, version_cache)
            
            assert len(changes) == 0

    def test_version_cache_updated(self):
        """Should update version cache after diff."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changelog = Changelog(Path(tmpdir) / "changelog.jsonl")
            version_cache = VersionCache(Path(tmpdir) / "cache")
            
            data = {"id": "test", "topic": "Topic"}
            diff_and_log("test.yaml", data, changelog, version_cache)
            
            cached = version_cache.get_previous("test.yaml")
            assert cached == data
