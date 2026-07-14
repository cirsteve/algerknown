FROM python:3.12-slim

WORKDIR /app

# Install dependencies (jig wheel copied first for layer caching)
COPY wheels/ wheels/
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformers model for offline use
# This ensures the container can start without network access
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy application code
COPY *.py .

# Create directory for the jig memory store SQLite files
RUN mkdir -p /app/memory_db

# Expose port
EXPOSE 4735

# Health check (using Python since curl is not in slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:4735/health')" || exit 1

# Loopback by default. Container-to-container/host-published access needs
# RAG_HOST=0.0.0.0, set only in the documented docker-compose.yml override
# (see docs/springfield-deployment.md) - never hardcoded here.
ENV RAG_HOST=127.0.0.1
ENV RAG_PORT=4735

# Run the server (shell form so RAG_HOST/RAG_PORT env vars expand)
CMD uvicorn api:app --host ${RAG_HOST} --port ${RAG_PORT}
