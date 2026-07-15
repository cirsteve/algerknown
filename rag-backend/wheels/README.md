# Vendored Jig wheel

`jig-0.1.0-py3-none-any.whl` is built from the
[RankOneLabs Jig repository](https://github.com/rankonelabs/jig) at commit
`2c7efc978c2756a11bfdccc3da3309a3c01a941b`. Its expected SHA-256 is
`a2d003554befd5eeb982a904b1c72224bc63ddecaaa3d0cdec26555094d3b7bb`.

That revision supplies the `jig.memory.local.SqliteStore` and
`jig.memory.local.DenseRetriever` API consumed by `rag-backend/vectorstore.py`,
while retaining `jig.llm.DispatchClient` for the configured dispatch provider.

Rebuild it from a checkout of that commit with:

```bash
uv build --wheel --out-dir /tmp/jig-wheel .
cp /tmp/jig-wheel/jig-0.1.0-py3-none-any.whl \
  /path/to/algerknown/rag-backend/wheels/
```

After replacement, verify the public imports before running the RAG suite:

```bash
python -c "from jig.memory.local import DenseRetriever, SqliteStore"
pytest tests/ -q
```
