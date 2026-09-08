#!/usr/bin/env python3
"""Extract an anchored region of an Office/PDF file into a NEW file.

The source file is opened read-only and never modified. Anchors address the
document's own structural coordinates (worksheet range, body-level paragraph
ordinal, page number) — see SKILL.md for the anchor JSON shapes.

Format-specific third-party readers are imported lazily, so run this with the
dependency matching the source format, e.g.:

    uv run --with openpyxl python office_extract.py \
        --file /abs/report.xlsx \
        --anchor '{"format":"xlsx","sheet":"Sheet1","range":"A1:C10"}' \
        --out /abs/report-extract.csv

Dependencies by source format: xlsx -> openpyxl, docx -> python-docx,
pdf -> pypdf, pptx -> python-pptx.
"""

import argparse
import sys

# SkillInstaller verifies built-in skills by directory hash; a __pycache__ dir would
# make that hash mismatch and the skill would be unlinked, so never write bytecode.
# The sibling imports below are what would create one, so this has to come first.
sys.dont_write_bytecode = True

from pathlib import Path

from office import docx, pdf, pptx, xlsx
from office.common import (
    atomic_output,
    fail,
    parse_json_object,
    preflight_zip_path,
    validate_io_paths,
)


EXTRACTORS = {
    "xlsx": xlsx.extract_xlsx,
    "docx": docx.extract_docx,
    "pdf": pdf.extract_pdf,
    "pptx": pptx.extract_pptx,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="absolute path of the source document (read-only)")
    parser.add_argument("--anchor", required=True, help="anchor JSON, e.g. '{\"format\":\"xlsx\",...}'")
    parser.add_argument("--out", required=True, help="absolute path of the NEW file to create; must not exist")
    args = parser.parse_args()

    src = Path(args.file)
    out_path = Path(args.out)
    validate_io_paths(src, out_path)

    anchor = parse_json_object(args.anchor, "anchor")
    anchor_format = anchor.get("format")
    extractor = EXTRACTORS.get(anchor_format) if isinstance(anchor_format, str) else None
    if extractor is None:
        fail(f"unsupported anchor format: {anchor_format!r} (use xlsx, docx, pdf, or pptx)")

    out_format = out_path.suffix.lstrip(".").lower()
    if not out_format:
        fail("output path needs an extension so the output format can be inferred")

    if anchor_format in ("xlsx", "docx", "pptx"):
        preflight_zip_path(src)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with atomic_output(out_path) as staging:
        extractor(src, anchor, staging, out_format)
    print(str(out_path))


if __name__ == "__main__":
    main()
