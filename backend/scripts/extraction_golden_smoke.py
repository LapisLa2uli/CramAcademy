#!/usr/bin/env python3
"""
Manual regression helper for the extraction pipeline.

Without arguments: verifies imports (use in CI as a cheap smoke step).

With a PDF path: runs ``run_analyze`` (requires ``OPENAI_API_KEY`` / working AI config).
Example::

    cd backend && python scripts/extraction_golden_smoke.py ./fixtures/sample.pdf
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _imports_only() -> int:
    from services.extraction.cross_page import build_page_summaries  # noqa: F401
    from services.extraction.normalize import merge_page_results  # noqa: F401
    from services.extraction.openai_extract import extract_page  # noqa: F401
    from services.extraction.pipeline import iter_analyze, run_analyze  # noqa: F401

    print("extraction imports OK")
    return 0


def _unit_tests() -> int:
    import unittest

    suite = unittest.defaultTestLoader.discover(
        str(BACKEND_ROOT / "tests"),
        pattern="test_*.py",
    )
    runner = unittest.TextTestRunner(verbosity=1)
    res = runner.run(suite)
    return 0 if res.wasSuccessful() else 1


async def _run_pdf(path: Path) -> int:
    from config import get_settings
    from services.extraction.pipeline import run_analyze

    settings = get_settings()
    if not settings.extraction_enabled:
        print("EXTRACTION_ENABLED is false; skip.")
        return 0
    if not settings.openai_api_key.strip():
        print("OPENAI_API_KEY unset; skip live run.")
        return 0

    raw = path.read_bytes()
    res = await run_analyze(
        [(path.name, raw)],
        max_pages=3,
        high_accuracy=False,
        two_stage=False,
    )
    if not res.pages:
        print("FAIL: no pages in response")
        return 1
    print(
        f"OK: pages={len(res.pages)} sets={len(res.sets)} warnings={len(res.warnings)}"
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Extraction pipeline smoke / golden helper.")
    p.add_argument(
        "pdf",
        nargs="?",
        type=Path,
        help="Optional PDF to analyze (calls the vision API).",
    )
    p.add_argument(
        "--unit",
        action="store_true",
        help="Run AP extraction unit tests (no API; no imports-only shortcut).",
    )
    args = p.parse_args()
    if args.unit:
        return _unit_tests()
    if args.pdf is None:
        return _imports_only()
    if not args.pdf.is_file():
        print(f"Not a file: {args.pdf}", file=sys.stderr)
        return 2
    return asyncio.run(_run_pdf(args.pdf))


if __name__ == "__main__":
    raise SystemExit(main())
