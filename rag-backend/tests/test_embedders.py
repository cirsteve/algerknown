"""Tests for the embedder factory.

Avoid instantiating the OpenAI / sentence-transformers embedders when
picking them — both would load models or SDK clients at module scope.
We check which factory branch `select_embedder` took by patching the
factory functions with sentinels.
"""

from __future__ import annotations

import numpy as np
import pytest

import embedders


async def test_mock_embedder_is_deterministic() -> None:
    embed = embedders.mock_embedder()

    v1 = await embed("hello world")
    v2 = await embed("hello world")
    v3 = await embed("different input")

    assert v1.dtype == np.float32
    assert v1.shape == (384,)
    assert np.array_equal(v1, v2)
    assert not np.array_equal(v1, v3)


async def test_mock_embedder_custom_dim() -> None:
    embed = embedders.mock_embedder(dim=128)
    v = await embed("x")
    assert v.shape == (128,)


def test_looks_like_real_openai_key() -> None:
    assert embedders._looks_like_real_openai_key("sk-abc123")
    assert not embedders._looks_like_real_openai_key("")
    assert not embedders._looks_like_real_openai_key("sk-...")
    assert not embedders._looks_like_real_openai_key("test-key")
    assert not embedders._looks_like_real_openai_key("gpt-4")


def test_select_embedder_mock_env(monkeypatch) -> None:
    monkeypatch.setenv("USE_MOCK_EMBEDDINGS", "true")
    monkeypatch.setenv("USE_LOCAL_EMBEDDINGS", "true")  # lower priority
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-looking-key")  # lower priority

    sentinel = object()
    monkeypatch.setattr(embedders, "mock_embedder", lambda: sentinel)

    assert embedders.select_embedder() is sentinel


def test_select_embedder_local_env(monkeypatch) -> None:
    monkeypatch.delenv("USE_MOCK_EMBEDDINGS", raising=False)
    monkeypatch.setenv("USE_LOCAL_EMBEDDINGS", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real-looking-key")

    sentinel = object()
    monkeypatch.setattr(
        embedders, "sentence_transformer_embedder", lambda: sentinel
    )

    assert embedders.select_embedder() is sentinel


def test_select_embedder_openai_when_key_valid(monkeypatch) -> None:
    monkeypatch.delenv("USE_MOCK_EMBEDDINGS", raising=False)
    monkeypatch.delenv("USE_LOCAL_EMBEDDINGS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-abc123")

    sentinel = object()
    monkeypatch.setattr(embedders, "openai_embedder", lambda key: sentinel)

    assert embedders.select_embedder() is sentinel


def test_select_embedder_falls_back_to_local(monkeypatch) -> None:
    monkeypatch.delenv("USE_MOCK_EMBEDDINGS", raising=False)
    monkeypatch.delenv("USE_LOCAL_EMBEDDINGS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-...")  # placeholder — rejected

    sentinel = object()
    monkeypatch.setattr(
        embedders, "sentence_transformer_embedder", lambda: sentinel
    )

    assert embedders.select_embedder() is sentinel


@pytest.mark.parametrize("truthy", ["true", "1", "yes", "TRUE", "True"])
def test_env_var_truthy_values(monkeypatch, truthy: str) -> None:
    monkeypatch.setenv("USE_MOCK_EMBEDDINGS", truthy)

    sentinel = object()
    monkeypatch.setattr(embedders, "mock_embedder", lambda: sentinel)

    assert embedders.select_embedder() is sentinel
