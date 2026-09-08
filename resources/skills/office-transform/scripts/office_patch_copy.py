#!/usr/bin/env python3
"""Derive a new .xlsx/.docx by copying the original package and rewriting only
the XML parts the requested edits touch.

OOXML files are ZIP packages of XML parts. This script copies every part of
the original byte-for-byte and re-serializes only what an edit reaches: the
targeted part (one worksheet, or word/document.xml) and, for xlsx, the workbook
bookkeeping named below. Fidelity risk is confined to those.
The touched part is manipulated with xml.dom.minidom, which round-trips
namespace prefixes and declarations verbatim (unlike ElementTree, which
rewrites unknown prefixes and breaks mc:Ignorable references). The source
file is never modified. Standard library only — no dependencies.

Edit JSON shapes (pass via --edits):

    {"format": "xlsx", "sheet": "Sheet1", "cells": {"B2": 42, "C3": "hello", "D4": true}}
    {"format": "docx", "replacements": [{"paragraph": 3, "text": "new text",
                                          "paraId": "502E8D33", "expectText": "old text"}]}

xlsx: each cell is overwritten with the JSON value (number, string, or
boolean); an ordinary formula in that cell is replaced by the value, while a
cell belonging to a shared, array, or data-table formula group is refused (see
reject_shared_formula and grouped_formula_ranges). The worksheet's <dimension>
is widened when edits create cells outside it. Any write also sets fullCalcOnLoad
on xl/workbook.xml (see request_full_recalc), and replacing a formula additionally
drops xl/calcChain.xml (see drop_calc_chain); those, plus [Content_Types].xml /
workbook.xml.rels, are the only parts besides the edited worksheet this script
ever rewrites.
docx: 'paragraph' is the zero-based ordinal among BODY-LEVEL paragraphs
(direct w:body children; tables excluded). Optional 'paraId' (w14:paraId) is
resolved first when present; a paraId that resolves to a different paragraph
than the ordinal is an error, never a silent pick. Optional 'expectText' is a
hard gate: the target paragraph's current text (whitespace-normalized) must
equal it or the edit is refused — take its value from a prior extract of the
anchor, not from a selection-ref excerpt. The paragraph keeps its paragraph
style and the first run's character style, and extra run-level styling is
flattened into the new text. A paragraph holding anything the output shape
cannot carry is refused rather than silently stripped — see
reject_unrepresentable_content, which allow-lists what survives instead of
enumerating what is dangerous.

The output is written to a staging file and renamed on success, so a failure
never leaves a partial package behind (see atomic_output).
"""

import argparse
import sys

# SkillInstaller verifies built-in skills by directory hash; a __pycache__ dir would
# make that hash mismatch and the skill would be unlinked, so never write bytecode.
# The sibling imports below are what would create one, so this has to come first.
sys.dont_write_bytecode = True

import zipfile
from pathlib import Path

from office import docx, xlsx
from office.common import (
    atomic_output,
    fail,
    parse_json_object,
    preflight_zip,
    validate_io_paths,
)


PATCHERS = {
    "xlsx": xlsx.patch_xlsx,
    "docx": docx.patch_docx,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="absolute path of the source document (read-only)")
    parser.add_argument("--edits", required=True, help="edit JSON — see module docstring for shapes")
    parser.add_argument("--out", required=True, help="absolute path of the NEW file to create; must not exist")
    args = parser.parse_args()

    src = Path(args.file)
    out_path = Path(args.out)
    validate_io_paths(src, out_path)

    edits = parse_json_object(args.edits, "edits")
    edits_format = edits.get("format")
    patcher = PATCHERS.get(edits_format) if isinstance(edits_format, str) else None
    if patcher is None:
        fail(f"unsupported edits format: {edits_format!r} (use xlsx or docx)")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Build beside the target and rename only on success. A package written in place and interrupted
    # mid-copy stays a readable file with the edit already applied — it just silently misses the parts
    # that never got copied — and then blocks the retry with "output path already exists".
    with atomic_output(out_path) as staging:
        with zipfile.ZipFile(src) as archive:
            preflight_zip(archive)
            replaced_parts, dropped_parts = patcher(archive, edits)
            with zipfile.ZipFile(staging, "w") as derived:
                for item in archive.infolist():
                    if item.filename in dropped_parts:
                        continue
                    data = replaced_parts.get(item.filename, None)
                    if data is None:
                        data = archive.read(item.filename)
                    derived.writestr(item, data, compress_type=item.compress_type)
    print(str(out_path))


if __name__ == "__main__":
    main()
