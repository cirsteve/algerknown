"""
Algerknown RAG - Embedders

Builds the `Embedder` jig's SqliteStore needs — an async callable mapping
a string to a float32 numpy array. Selection mirrors the precedence
used by the old ChromaDB-backed VectorStore so operators don't need to
change their `.env` when upgrading.

Precedence (highest wins):
  USE_MOCK_EMBEDDINGS=true    -> deterministic sha256-seeded 384-dim
  USE_LOCAL_EMBEDDINGS=true   -> sentence-transformers all-MiniLM-L6-v2
  OPENAI_API_KEY looks real   -> OpenAI text-embedding-3-small (1536-dim)
  fallback                    -> sentence-transformers all-MiniLM-L6-v2
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import Awaitable, Callable

import numpy as np

logger = logging.getLogger(__name__)

# Type alias — jig's SqliteStore/DenseRetriever accept any callable of
# this shape. Matches `jig.memory.local.Embedder`.
Embedder = Callable[[str], Awaitable[np.ndarray]]


def mock_embedder(dim: int = 384) -> Embedder:
    """Deterministic sha256-seeded embeddings — no network, same value
    for the same input across runs. Useful for tests and cold CI."""

    async def embed(text: str) -> np.ndarray:
        sha = hashlib.sha256(text.encode("utf-8")).digest()
        seed_val = int.from_bytes(sha[:8], "big")
        values = [((seed_val * (i + 1)) % 10000) / 5000.0 - 1.0 for i in range(dim)]
        return np.array(values, dtype=np.float32)

    return embed


def openai_embedder(
    api_key: str, model: str = "text-embedding-3-small"
) -> Embedder:
    """OpenAI embeddings via the official async SDK. Matches the
    pre-migration default when OPENAI_API_KEY was present."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    async def embed(text: str) -> np.ndarray:
        resp = await client.embeddings.create(model=model, input=text)
        return np.array(resp.data[0].embedding, dtype=np.float32)

    return embed


def sentence_transformer_embedder(
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
) -> Embedder:
    """Local sentence-transformers embeddings. The model is loaded once
    at import; `encode` is pushed to a thread because the underlying
    `model.encode` is blocking."""
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name)

    async def embed(text: str) -> np.ndarray:
        vec = await asyncio.to_thread(model.encode, text, convert_to_numpy=True)
        return vec.astype(np.float32)

    return embed


def _looks_like_real_openai_key(key: str) -> bool:
    """Same heuristic as the pre-migration `get_embedding_function`:
    reject empty, placeholder ('sk-...'), and test ('test*') keys."""
    return bool(
        key and key.startswith("sk-") and key != "sk-..." and not key.startswith("test")
    )


def select_embedder() -> Embedder:
    """Return the embedder selected by the current environment.

    The precedence matches the pre-migration `get_embedding_function`
    exactly so an operator's `.env` still resolves to the same backend
    after upgrading. Callers that want to force a specific embedder
    (e.g. tests) should construct one directly and pass it to
    `VectorStore(embedder=...)`.
    """
    if os.getenv("USE_MOCK_EMBEDDINGS", "").lower() in ("true", "1", "yes"):
        logger.info("Using mock embeddings (USE_MOCK_EMBEDDINGS=true)")
        return mock_embedder()

    if os.getenv("USE_LOCAL_EMBEDDINGS", "").lower() in ("true", "1", "yes"):
        logger.info(
            "Using local sentence-transformers embeddings "
            "(USE_LOCAL_EMBEDDINGS=true)"
        )
        return sentence_transformer_embedder()

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if _looks_like_real_openai_key(openai_key):
        logger.info("Using OpenAI embeddings (text-embedding-3-small)")
        return openai_embedder(openai_key)

    logger.info(
        "Using local sentence-transformers embeddings (no valid OpenAI key)"
    )
    return sentence_transformer_embedder()
