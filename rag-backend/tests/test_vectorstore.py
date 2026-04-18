"""
Tests for the vectorstore module.

Uses the deterministic mock embedder to avoid network calls and model
downloads. Tests match the pre-migration coverage; only fixture
construction and awaits changed.
"""

from __future__ import annotations

import pytest

from embedders import mock_embedder
from vectorstore import VectorStore


@pytest.fixture
async def vector_store(tmp_path):
    """VectorStore with mock embeddings, one-shot per test."""
    store = VectorStore(str(tmp_path / "memory.db"), embedder=mock_embedder())
    yield store
    await store.close()


@pytest.fixture
def sample_documents():
    return [
        {
            "id": "doc-001",
            "content": "Zero-knowledge proofs allow verification without revealing data.",
            "metadata": {
                "type": "entry",
                "topic": "ZK Proofs Basics",
                "tags": "zk,cryptography",
                "status": "active",
            },
        },
        {
            "id": "doc-002",
            "content": "Nullifiers prevent double-spending in anonymous systems.",
            "metadata": {
                "type": "entry",
                "topic": "Nullifiers",
                "tags": "zk,privacy",
                "status": "active",
            },
        },
        {
            "id": "summary-001",
            "content": "Summary of zero-knowledge concepts and learnings.",
            "metadata": {
                "type": "summary",
                "topic": "ZK Summary",
                "tags": "zk,summary",
                "status": "reference",
            },
        },
    ]


class TestVectorStoreInit:
    """Tests for VectorStore initialization."""

    async def test_init_creates_store(self, tmp_path):
        store = VectorStore(str(tmp_path / "memory.db"), embedder=mock_embedder())
        try:
            assert store is not None
            assert await store.count() == 0
        finally:
            await store.close()

    async def test_init_persists(self, tmp_path, sample_documents):
        db_path = str(tmp_path / "memory.db")

        store1 = VectorStore(db_path, embedder=mock_embedder())
        await store1.index_documents(sample_documents)
        await store1.close()

        store2 = VectorStore(db_path, embedder=mock_embedder())
        try:
            assert await store2.count() == 3
        finally:
            await store2.close()

    async def test_init_accepts_directory_path(self, tmp_path):
        """Legacy behavior: directory path → `<dir>/memory.db`."""
        dir_path = tmp_path / "legacy_dir"
        dir_path.mkdir()
        store = VectorStore(str(dir_path), embedder=mock_embedder())
        try:
            assert await store.count() == 0
            assert (dir_path / "memory.db").parent.exists()
        finally:
            await store.close()


class TestIndexDocuments:
    """Tests for document indexing."""

    async def test_index_documents(self, vector_store, sample_documents):
        n = await vector_store.index_documents(sample_documents)
        assert n == 3
        assert await vector_store.count() == 3

    async def test_index_empty_list(self, vector_store):
        assert await vector_store.index_documents([]) == 0

    async def test_upsert_updates_existing(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        modified = [
            {
                "id": "doc-001",
                "content": "Updated content about ZK proofs.",
                "metadata": sample_documents[0]["metadata"],
            }
        ]
        await vector_store.index_documents(modified)

        assert await vector_store.count() == 3
        doc = await vector_store.get_by_id("doc-001")
        assert doc is not None
        assert "Updated content" in doc["content"]


class TestQuery:
    """Tests for vector search."""

    async def test_query_returns_results(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        results = await vector_store.query("zero-knowledge proofs", n_results=2)

        assert len(results) == 2
        assert all("id" in r for r in results)
        assert all("content" in r for r in results)
        assert all("distance" in r for r in results)

    async def test_query_with_filter(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        results = await vector_store.query(
            "zero-knowledge",
            n_results=10,
            where={"type": "summary"},
        )

        assert len(results) == 1
        assert results[0]["id"] == "summary-001"

    async def test_query_respects_n_results(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        results = await vector_store.query("proof", n_results=1)

        assert len(results) == 1

    async def test_query_empty_store(self, vector_store):
        assert await vector_store.query("anything") == []


class TestGetSummaries:
    """Tests for get_summaries method."""

    async def test_get_summaries_returns_only_summaries(
        self, vector_store, sample_documents
    ):
        await vector_store.index_documents(sample_documents)

        summaries = await vector_store.get_summaries()

        assert len(summaries) == 1
        assert summaries[0]["id"] == "summary-001"
        assert summaries[0]["metadata"]["type"] == "summary"

    async def test_get_summaries_empty(self, vector_store):
        await vector_store.index_documents(
            [
                {
                    "id": "entry-only",
                    "content": "Just an entry",
                    "metadata": {
                        "type": "entry",
                        "topic": "Test",
                        "tags": "",
                        "status": "",
                    },
                }
            ]
        )

        assert await vector_store.get_summaries() == []

    async def test_get_summaries_reconstructs_chunked_summary(self, vector_store):
        long_summary = "START " + ("A" * 3500) + "\n\n" + ("B" * 3500) + " END"
        await vector_store.index_documents(
            [
                {
                    "id": "summary-long",
                    "content": long_summary,
                    "metadata": {
                        "type": "summary",
                        "topic": "Long Summary",
                        "tags": "summary,test",
                        "status": "reference",
                    },
                }
            ]
        )

        summaries = await vector_store.get_summaries()

        assert len(summaries) == 1
        assert summaries[0]["id"] == "summary-long"
        assert summaries[0]["content"] == long_summary
        assert summaries[0]["content"].startswith("START")
        assert summaries[0]["content"].endswith("END")


class TestGetById:
    """Tests for get_by_id method."""

    async def test_get_existing_document(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        doc = await vector_store.get_by_id("doc-001")

        assert doc is not None
        assert doc["id"] == "doc-001"
        assert "content" in doc

    async def test_get_nonexistent_document(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        assert await vector_store.get_by_id("nonexistent") is None


class TestGetAll:
    """Tests for get_all method."""

    async def test_get_all_documents(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        all_docs = await vector_store.get_all()

        assert len(all_docs) == 3

    async def test_get_all_empty_store(self, vector_store):
        assert await vector_store.get_all() == []

    async def test_get_all_reconstructs_chunked_documents(self, vector_store):
        long_entry = "HEAD " + ("X" * 3500) + "\n\n" + ("Y" * 3500) + " TAIL"
        await vector_store.index_documents(
            [
                {
                    "id": "entry-long",
                    "content": long_entry,
                    "metadata": {
                        "type": "entry",
                        "topic": "Long Entry",
                        "tags": "entry,test",
                        "status": "active",
                    },
                }
            ]
        )

        all_docs = await vector_store.get_all()

        assert len(all_docs) == 1
        assert all_docs[0]["id"] == "entry-long"
        assert all_docs[0]["content"] == long_entry


class TestDelete:
    """Tests for delete method."""

    async def test_delete_document(self, vector_store, sample_documents):
        await vector_store.index_documents(sample_documents)

        result = await vector_store.delete("doc-001")

        assert result is True
        assert await vector_store.count() == 2
        assert await vector_store.get_by_id("doc-001") is None

    async def test_delete_removes_all_chunks(self, vector_store):
        long_entry = "A" * 4000 + "\n\n" + "B" * 4000
        await vector_store.index_documents(
            [
                {
                    "id": "long-doc",
                    "content": long_entry,
                    "metadata": {"type": "entry", "topic": "t", "tags": "", "status": ""},
                }
            ]
        )

        await vector_store.delete("long-doc")

        assert await vector_store.count() == 0
