"""
Loads configuration from environment variables, falling back to a gitignored
`.secrets.env` file that's shipped in the Docker image when running on Fly.io.

This is a pragmatic workaround for the deploy tool not propagating env vars.
The token sits only inside the private Fly.io image; it is not committed to git.
"""
from __future__ import annotations

import os
from pathlib import Path


def load_once() -> None:
    path = Path(__file__).parent.parent / ".secrets.env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
