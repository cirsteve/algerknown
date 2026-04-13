"""
Pytest configuration and fixtures.
"""

import sys
from pathlib import Path

# Add parent directory to path so tests can import modules
sys.path.insert(0, str(Path(__file__).parent.parent))
# Add tests directory to path so tests can import helpers
sys.path.insert(0, str(Path(__file__).parent))

import os
import pytest

from helpers import make_llm_response

# Set test environment variables
os.environ["OPENAI_API_KEY"] = "test-key"
os.environ["ANTHROPIC_API_KEY"] = "test-key"


@pytest.fixture
def mock_llm_response():
    """Factory fixture for creating mock LLM responses."""
    return make_llm_response
