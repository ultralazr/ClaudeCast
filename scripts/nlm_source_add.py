#!/usr/bin/env python3
"""
Direct NLM source add — bypasses the CLI wrapper which has issues.
Usage: python nlm_source_add.py <notebook_id> <text>
Exits 0 on success, 1 on failure.
"""
import sys

from notebooklm_tools.core.auth import load_cached_tokens
from notebooklm_tools.core.client import NotebookLMClient

def main():
    if len(sys.argv) < 3:
        print("Usage: nlm_source_add.py <notebook_id> <text_or_file> [title]", file=sys.stderr)
        sys.exit(1)

    notebook_id = sys.argv[1]
    text_or_file = sys.argv[2]
    title = sys.argv[3] if len(sys.argv) > 3 else "Source"

    # If argument looks like a file path and file exists, read from it
    import os
    if os.path.isfile(text_or_file):
        with open(text_or_file, 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = text_or_file

    cached = load_cached_tokens()
    if not cached:
        print("No auth tokens found. Run 'nlm login' first.", file=sys.stderr)
        sys.exit(1)

    client = NotebookLMClient(
        cookies=cached.cookies,
        csrf_token=cached.csrf_token,
        session_id=cached.session_id or "",
    )

    result = client.add_text_source(notebook_id, text, title, wait=True)
    if result and result.get("id"):
        print(f"OK: {result['id']}")
        sys.exit(0)
    else:
        print(f"Failed: {result}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
