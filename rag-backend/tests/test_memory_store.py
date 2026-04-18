"""Tests for memory_store — the jig-backed replacement for vectorstore.

Uses the mock embedder (no network) and a per-test temp sqlite file so
each test starts clean.
"""

from __future__ import annotations

import pytest

from memory_store import (
    build_memory,
    chunk_text,
    count,
    get_all,
    get_by_id,
    get_summaries,
    index_documents,
    mock_embedder,
    search,
)


@pytest.fixture
async def memory(tmp_path):
    """Fresh SqliteStore + DenseRetriever wired to the mock embedder."""
    store, retriever = await build_memory(
        db_path=str(tmp_path / "memory.db"),
        embedder=mock_embedder(),
    )
    yield store, retriever
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


# --- Init / persistence -----------------------------------------------------


async def test_empty_store_count_is_zero(memory):
    store, _ = memory
    assert await count(store) == 0


async def test_persistence_across_reopens(tmp_path, sample_documents):
    db_path = str(tmp_path / "memory.db")
    store1, _ = await build_memory(db_path=db_path, embedder=mock_embedder())
    await index_documents(store1, sample_documents)
    await store1.close()

    store2, _ = await build_memory(db_path=db_path, embedder=mock_embedder())
    try:
        assert await count(store2) == 3
    finally:
        await store2.close()


# --- Index / upsert ---------------------------------------------------------


async def test_index_documents_increments_count(memory, sample_documents):
    store, _ = memory
    n = await index_documents(store, sample_documents)
    assert n == 3
    assert await count(store) == 3


async def test_index_empty_list_is_noop(memory):
    store, _ = memory
    assert await index_documents(store, []) == 0
    assert await count(store) == 0


async def test_reindex_replaces_existing(memory, sample_documents):
    store, _ = memory
    await index_documents(store, sample_documents)

    updated = [
        {
            "id": "doc-001",
            "content": "Updated content about ZK proofs.",
            "metadata": sample_documents[0]["metadata"],
        }
    ]
    await index_documents(store, updated)

    assert await count(store) == 3
    doc = await get_by_id(store, "doc-001")
    assert doc is not None
    assert "Updated content" in doc["content"]


# --- Query ------------------------------------------------------------------


async def test_search_returns_top_k_with_distance(memory, sample_documents):
    store, retriever = memory
    await index_documents(store, sample_documents)

    results = await search(retriever, "zero-knowledge proofs", n_results=2)

    assert len(results) == 2
    for r in results:
        assert "id" in r
        assert "content" in r
        assert "distance" in r


async def test_search_metadata_filter(memory, sample_documents):
    store, retriever = memory
    await index_documents(store, sample_documents)

    results = await search(retriever, "anything", n_results=10, where={"type": "summary"})

    assert len(results) == 1
    assert results[0]["id"] == "summary-001"


async def test_search_respects_n_results(memory, sample_documents):
    store, retriever = memory
    await index_documents(store, sample_documents)

    results = await search(retriever, "proof", n_results=1)

    assert len(results) == 1


async def test_search_empty_store(memory):
    _, retriever = memory
    assert await search(retriever, "anything") == []


# --- Summaries -------------------------------------------------------------


async def test_get_summaries_filters_to_summary_type(memory, sample_documents):
    store, _ = memory
    await index_documents(store, sample_documents)

    summaries = await get_summaries(store)

    assert len(summaries) == 1
    assert summaries[0]["id"] == "summary-001"
    assert summaries[0]["metadata"]["type"] == "summary"


async def test_get_summaries_empty_when_no_summaries(memory):
    store, _ = memory
    await index_documents(
        store,
        [
            {
                "id": "entry-only",
                "content": "Just an entry",
                "metadata": {"type": "entry", "topic": "Test", "tags": "", "status": ""},
            }
        ],
    )
    assert await get_summaries(store) == []


async def test_get_summaries_reconstructs_chunked_summary(memory):
    store, _ = memory
    long_summary = "START " + ("A" * 3500) + "\n\n" + ("B" * 3500) + " END"
    await index_documents(
        store,
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
        ],
    )

    summaries = await get_summaries(store)

    assert len(summaries) == 1
    assert summaries[0]["id"] == "summary-long"
    assert summaries[0]["content"] == long_summary
    assert summaries[0]["content"].startswith("START")
    assert summaries[0]["content"].endswith("END")


# --- get_by_id / get_all ---------------------------------------------------


async def test_get_by_id_returns_existing(memory, sample_documents):
    store, _ = memory
    await index_documents(store, sample_documents)

    doc = await get_by_id(store, "doc-001")

    assert doc is not None
    assert doc["id"] == "doc-001"
    assert "content" in doc


async def test_get_by_id_missing_returns_none(memory, sample_documents):
    store, _ = memory
    await index_documents(store, sample_documents)

    assert await get_by_id(store, "missing") is None


async def test_get_all_returns_all_documents(memory, sample_documents):
    store, _ = memory
    await index_documents(store, sample_documents)

    all_docs = await get_all(store)

    assert len(all_docs) == 3


async def test_get_all_reconstructs_chunked_entries(memory):
    store, _ = memory
    long_entry = "HEAD " + ("X" * 3500) + "\n\n" + ("Y" * 3500) + " TAIL"
    await index_documents(
        store,
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
        ],
    )

    all_docs = await get_all(store)

    assert len(all_docs) == 1
    assert all_docs[0]["id"] == "entry-long"
    assert all_docs[0]["content"] == long_entry


# --- Chunking --------------------------------------------------------------


def test_chunk_text_short_returns_single():
    assert chunk_text("short", max_chars=100) == ["short"]


def test_chunk_text_splits_on_paragraphs():
    doc = ("A" * 3500) + "\n\n" + ("B" * 3500)
    chunks = chunk_text(doc, max_chars=6000)
    assert len(chunks) == 2
    assert chunks[0].startswith("A")
    assert chunks[1].startswith("B")
