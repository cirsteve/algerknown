"""
Algerknown RAG - Diff Engine

Node-level diff tracking for YAML content.
Compares document versions and generates structured change sets.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from ruamel.yaml import YAML

logger = logging.getLogger(__name__)

yaml = YAML()
yaml.preserve_quotes = True


# ============ Node Path Utilities ============

def flatten_to_nodes(data: Any, path: str = "") -> dict[str, Any]:
    """
    Flatten a nested structure into a dict of path -> value pairs.
    
    Paths use dot notation for objects and bracket notation for arrays.
    Example: {"foo": {"bar": [1, 2]}} -> {"foo.bar[0]": 1, "foo.bar[1]": 2}
    
    Args:
        data: The data structure to flatten
        path: Current path prefix
        
    Returns:
        Dict mapping paths to leaf values
    """
    nodes = {}
    
    if isinstance(data, dict):
        for key, value in data.items():
            new_path = f"{path}.{key}" if path else key
            if isinstance(value, (dict, list)) and value:
                nodes.update(flatten_to_nodes(value, new_path))
            else:
                nodes[new_path] = value
    elif isinstance(data, list):
        for i, item in enumerate(data):
            new_path = f"{path}[{i}]"
            if isinstance(item, (dict, list)) and item:
                nodes.update(flatten_to_nodes(item, new_path))
            else:
                nodes[new_path] = item
    else:
        if path:
            nodes[path] = data
    
    return nodes


def get_node_value(data: Any, path: str) -> tuple[bool, Any]:
    """
    Get a value at a specific path in nested data.
    
    Args:
        data: The data structure
        path: Dot/bracket notation path
        
    Returns:
        Tuple of (found, value)
    """
    if not path:
        return True, data
    
    parts = _parse_path(path)
    current = data
    
    for part in parts:
        if isinstance(part, int):
            if not isinstance(current, list) or part < 0 or part >= len(current):
                return False, None
            current = current[part]
        else:
            if not isinstance(current, dict) or part not in current:
                return False, None
            current = current[part]
    
    return True, current


def _parse_path(path: str) -> list[str | int]:
    """Parse a path string into components."""
    parts = []
    current = ""
    i = 0
    
    while i < len(path):
        char = path[i]
        
        if char == ".":
            if current:
                parts.append(current)
                current = ""
        elif char == "[":
            if current:
                parts.append(current)
                current = ""
            # Find closing bracket
            j = path.find("]", i)
            if j == -1:
                raise ValueError(
                    f"Invalid path {path!r}: missing closing ']' for index starting at position {i}"
                )
            index_str = path[i + 1 : j]
            try:
                parts.append(int(index_str))
            except ValueError:
                raise ValueError(
                    f"Invalid path {path!r}: array index '{index_str}' is not a valid integer"
                )
            i = j
        else:
            current += char
        
        i += 1
    
    if current:
        parts.append(current)
    
    return parts


# ============ Diff Algorithm ============

class ChangeType:
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"


def compute_diff(
    old_data: dict | None,
    new_data: dict,
    source_file: str,
    timestamp: datetime | None = None
) -> list[dict]:
    """
    Compute the diff between two document versions.
    
    Args:
        old_data: Previous version (None if new document)
        new_data: Current version
        source_file: Path to source file
        timestamp: When the change occurred (defaults to now)
        
    Returns:
        List of change objects
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    
    # Use replace to get UTC time without offset, then add Z suffix
    timestamp_str = timestamp.replace(tzinfo=None).isoformat() + "Z"
    changes = []
    
    # Flatten both versions to node paths
    old_nodes = flatten_to_nodes(old_data) if old_data else {}
    new_nodes = flatten_to_nodes(new_data)
    
    all_paths = set(old_nodes.keys()) | set(new_nodes.keys())
    
    for path in sorted(all_paths):
        in_old = path in old_nodes
        in_new = path in new_nodes
        
        if in_new and not in_old:
            # Added
            changes.append({
                "timestamp": timestamp_str,
                "source": source_file,
                "type": ChangeType.ADDED,
                "path": path,
                "value": _serialize_value(new_nodes[path])
            })
        elif in_old and not in_new:
            # Removed
            changes.append({
                "timestamp": timestamp_str,
                "source": source_file,
                "type": ChangeType.REMOVED,
                "path": path,
                "old": _serialize_value(old_nodes[path])
            })
        elif old_nodes[path] != new_nodes[path]:
            # Modified
            changes.append({
                "timestamp": timestamp_str,
                "source": source_file,
                "type": ChangeType.MODIFIED,
                "path": path,
                "old": _serialize_value(old_nodes[path]),
                "new": _serialize_value(new_nodes[path])
            })
    
    return changes


def _serialize_value(value: Any) -> Any:
    """Serialize a value for JSON storage."""
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    elif isinstance(value, (list, dict)):
        return value
    else:
        return str(value)


# ============ Changelog Storage ============

class Changelog:
    """Append-only changelog stored as JSONL."""
    
    def __init__(self, path: str | Path):
        """
        Initialize changelog.
        
        Args:
            path: Path to changelog.jsonl file
        """
        self.path = Path(path)
        self._ensure_file()
    
    def _ensure_file(self):
        """Create changelog file if it doesn't exist."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch()
    
    def append(self, changes: list[dict]) -> int:
        """
        Append changes to the changelog.
        
        Args:
            changes: List of change objects
            
        Returns:
            Number of changes written
        """
        with open(self.path, "a") as f:
            for change in changes:
                f.write(json.dumps(change, ensure_ascii=False) + "\n")
        
        logger.info(f"Appended {len(changes)} changes to changelog")
        return len(changes)
    
    def read_all(self) -> list[dict]:
        """
        Read all changes from the changelog.
        
        Returns:
            List of all change objects, oldest first
        """
        changes = []
        
        if not self.path.exists():
            return changes
        
        with open(self.path, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        changes.append(json.loads(line))
                    except json.JSONDecodeError as e:
                        logger.warning(f"Invalid JSON in changelog: {e}")
        
        return changes
    
    def read_recent(self, limit: int = 50) -> list[dict]:
        """
        Read the most recent changes.
        
        Args:
            limit: Maximum number of changes to return
            
        Returns:
            List of recent changes, newest first
        """
        all_changes = self.read_all()
        # Sort by timestamp descending and limit
        all_changes.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return all_changes[:limit]
    
    def read_by_source(self, source: str) -> list[dict]:
        """
        Read all changes for a specific source file.
        
        Args:
            source: Source file path or name
            
        Returns:
            List of changes for that source, newest first
        """
        all_changes = self.read_all()
        filtered = [c for c in all_changes if c.get("source") == source]
        filtered.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return filtered
    
    def read_by_path(self, path: str) -> list[dict]:
        """
        Read all changes for a specific node path.
        
        Args:
            path: Node path (e.g., "zkSNARKs.tradeoffs")
            
        Returns:
            List of changes for that path, newest first
        """
        all_changes = self.read_all()
        filtered = [c for c in all_changes if c.get("path", "").startswith(path)]
        filtered.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return filtered
    
    def read_by_date_range(
        self,
        start: datetime | None = None,
        end: datetime | None = None
    ) -> list[dict]:
        """
        Read changes within a date range.
        
        Args:
            start: Start of range (inclusive)
            end: End of range (inclusive)
            
        Returns:
            List of changes in range, newest first
        """
        all_changes = self.read_all()
        
        start_str = start.replace(tzinfo=None).isoformat() + "Z" if start else ""
        end_str = end.replace(tzinfo=None).isoformat() + "Z" if end else "9999"
        
        filtered = [
            c for c in all_changes
            if start_str <= c.get("timestamp", "") <= end_str
        ]
        filtered.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return filtered
    
    def read_by_type(self, change_type: str) -> list[dict]:
        """
        Read changes of a specific type.
        
        Args:
            change_type: One of 'added', 'modified', 'removed'
            
        Returns:
            List of changes of that type, newest first
        """
        all_changes = self.read_all()
        filtered = [c for c in all_changes if c.get("type") == change_type]
        filtered.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return filtered


# ============ Document Version Cache ============

class VersionCache:
    """Cache of previous document versions for diffing."""
    
    def __init__(self, cache_dir: str | Path):
        """
        Initialize version cache.
        
        Args:
            cache_dir: Directory to store version snapshots
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def _cache_path(self, source_file: str) -> Path:
        """Get cache path for a source file."""
        # Use a sanitized version of the path as the cache key to avoid collisions
        # e.g., "entries/zkSNARKs.yaml" -> ".entries__zkSNARKs.yaml.prev"
        safe_name = source_file.replace("/", "__").replace("\\", "__")
        return self.cache_dir / f".{safe_name}.prev"
    
    def get_previous(self, source_file: str) -> dict | None:
        """
        Get the previous version of a document.
        
        Args:
            source_file: Path to the source file
            
        Returns:
            Previous version data or None if no previous version
        """
        cache_path = self._cache_path(source_file)
        
        if not cache_path.exists():
            return None
        
        try:
            with open(cache_path) as f:
                return yaml.load(f)
        except Exception as e:
            logger.warning(f"Failed to load previous version: {e}")
            return None
    
    def save_current(self, source_file: str, data: dict):
        """
        Save current version as the new "previous" for next diff.
        
        Args:
            source_file: Path to the source file
            data: Current document data
        """
        cache_path = self._cache_path(source_file)
        
        try:
            with open(cache_path, "w") as f:
                yaml.dump(data, f)
        except Exception as e:
            logger.warning(f"Failed to save version cache: {e}")


# ============ High-Level API ============

def diff_and_log(
    source_file: str,
    new_data: dict,
    changelog: Changelog,
    version_cache: VersionCache,
    timestamp: datetime | None = None
) -> list[dict]:
    """
    Compare document to previous version, log changes, and update cache.
    
    This is the main entry point for the diff engine during ingestion.
    
    Args:
        source_file: Path to the source file
        new_data: Current document data
        changelog: Changelog instance
        version_cache: Version cache instance
        timestamp: Optional timestamp for the changes
        
    Returns:
        List of changes that were logged
    """
    # Get previous version
    old_data = version_cache.get_previous(source_file)
    
    # Compute diff
    changes = compute_diff(old_data, new_data, source_file, timestamp)
    
    # Log changes
    if changes:
        changelog.append(changes)
        logger.info(f"Logged {len(changes)} changes for {source_file}")
    else:
        logger.debug(f"No changes detected for {source_file}")
    
    # Update cache with current version
    version_cache.save_current(source_file, new_data)
    
    return changes
