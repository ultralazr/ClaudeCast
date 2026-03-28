#!/usr/bin/env python3
"""
Direct NLM notebook query — bypasses the CLI wrapper which times out.
Usage: python nlm_query.py <notebook_id> <query_text>
Prints the answer to stdout. Exits 0 on success, 1 on failure.
"""
import sys

import os
from notebooklm_tools.core.auth import load_cached_tokens
from notebooklm_tools.core.client import NotebookLMClient

def main():
    if len(sys.argv) < 3:
        print("Usage: nlm_query.py <notebook_id> <query_text_or_file>", file=sys.stderr)
        sys.exit(1)

    notebook_id = sys.argv[1]
    query_text_or_file = sys.argv[2]

    if os.path.isfile(query_text_or_file):
        with open(query_text_or_file, 'r', encoding='utf-8') as f:
            query_text = f.read()
    else:
        query_text = query_text_or_file

    cached = load_cached_tokens()
    if not cached:
        print("No auth tokens found. Run 'nlm login' first.", file=sys.stderr)
        sys.exit(1)

    client = NotebookLMClient(
        cookies=cached.cookies,
        csrf_token=cached.csrf_token,
        session_id=cached.session_id or "",
    )

    result = client.query(notebook_id, query_text, timeout=180.0)
    if result and result.get("answer"):
        print(result["answer"])
        sys.exit(0)
    else:
        print(f"No answer returned: {result}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
