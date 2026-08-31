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
    {"format": "docx", "replacements": [{"paragraph": 3, "text": "new text"}]}

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
(direct w:body children; tables excluded); the paragraph keeps its paragraph
style and the first run's character style, and extra run-level styling is
flattened into the new text. A paragraph holding anything the output shape
cannot carry is refused rather than silently stripped — see
reject_unrepresentable_content, which allow-lists what survives instead of
enumerating what is dangerous.

The output is written to a staging file and renamed on success, so a failure
never leaves a partial package behind (see atomic_output).
"""

import argparse
import codecs
import contextlib
import json
import math
import os
import posixpath
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.dom import minidom

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_ATTR_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

# ISO 29500 Strict binds the same elements to a second namespace family. Every lookup below matches
# the Transitional URIs above literally, so a Strict package is out of scope — see reject_strict_ooxml.
STRICT_NS_PREFIX = "http://purl.oclc.org/ooxml/"

A1_CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")

CONTENT_TYPES_PART = "[Content_Types].xml"
WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels"
CALC_CHAIN_PART = "xl/calcChain.xml"
WORKBOOK_PART = "xl/workbook.xml"

MAX_ZIP_ENTRIES = 10_000
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024

# The SpreadsheetML grid (ECMA-376): columns A..XFD, rows 1..1048576. A1 notation happily spells
# coordinates past both, and writing one produces a cell Excel cannot place.
MAX_COLUMN_INDEX = 16_384
MAX_ROW_NUMBER = 1_048_576


def fail(message: str) -> "sys.NoReturn":
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def reject_strict_ooxml(namespace: str, part: str) -> None:
    """Refuse an ISO 29500 Strict package by name rather than by its symptom.

    Matching both families would assert the two are interchangeable, which they are not — attribute
    value spaces and date representations differ — and it would buy nothing, since openpyxl and
    python-docx, the readers this skill pairs with, cannot open Strict either. Only the diagnosis is
    worth fixing. Without this a Strict workbook reports having no worksheets at all, and a Strict
    paragraph is refused for "containing <w:r>": both send the caller searching the wrong file for
    the wrong problem.
    """
    if namespace.startswith(STRICT_NS_PREFIX):
        fail(
            f"{part} uses the ISO 29500 Strict namespace ({namespace}); this script reads Transitional "
            f"OOXML only, which is what Excel and Word write by default. Re-save the file in the "
            f'default format (not "Strict Open XML"), then retry.'
        )


@contextlib.contextmanager
def atomic_output(out_path: Path):
    """Yield a staging path in the destination directory, renamed onto `out_path` only on success.

    Nothing partial ever appears at the destination: a failure removes the staging file, so the same
    command can be retried without tripping the "output path already exists" check.

    `Path.replace` overwrites unconditionally, so the caller's earlier `out_path.exists()` check only
    narrows the window between deciding the path is free and taking it — it does not close it, and a
    patch-copy of a large workbook holds that window open for the whole rewrite. Claiming the path
    with `O_CREAT | O_EXCL` up front closes it. Only that claim sits outside the `try`, because
    `fail` raises `SystemExit` and cleaning up from inside it would delete the file whoever won the
    race had just published. Everything after the claim is inside, so a staging file that cannot
    even be created still takes the empty claim back down with it.

    office_extract.py carries this protocol verbatim, deliberately: each script stands alone and
    neither imports the other. Change one and change both — the no-overwrite guarantee is worth only
    as much as the weaker copy.
    """
    try:
        os.close(os.open(out_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
    except FileExistsError:
        fail(f"output path already exists: {out_path} — pick a fresh name instead of overwriting")
    staging = None
    try:
        handle, staging_name = tempfile.mkstemp(dir=out_path.parent, prefix=f".{out_path.name}.", suffix=".part")
        os.close(handle)
        staging = Path(staging_name)
        yield staging
        staging.replace(out_path)
    except BaseException:
        if staging is not None:
            staging.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)
        raise


def column_to_index(letters: str) -> int:
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index


def index_to_column(index: int) -> str:
    letters = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def parse_a1_cell(ref: str) -> tuple[int, int]:
    match = A1_CELL_RE.match(ref)
    if not match:
        fail(f"invalid A1 cell reference: {ref!r}")
    column, row = column_to_index(match.group(1)), int(match.group(2))
    if column > MAX_COLUMN_INDEX or row > MAX_ROW_NUMBER:
        fail(
            f"cell {ref!r} is outside the worksheet grid "
            f"(max {index_to_column(MAX_COLUMN_INDEX)}{MAX_ROW_NUMBER}); Excel cannot place it"
        )
    return column, row


def preflight_zip(archive: zipfile.ZipFile) -> None:
    """Refuse pathological packages before decompressing anything into memory."""
    infos = archive.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        fail(f"package has {len(infos)} entries (limit {MAX_ZIP_ENTRIES})")
    total = 0
    for info in infos:
        if info.file_size > MAX_ENTRY_BYTES:
            fail(f"package entry {info.filename!r} decompresses to {info.file_size} bytes (limit {MAX_ENTRY_BYTES})")
        total += info.file_size
    if total > MAX_TOTAL_BYTES:
        fail(f"package decompresses to {total} bytes in total (limit {MAX_TOTAL_BYTES})")


def reject_invalid_xml_text(value: str, where: str) -> None:
    """Refuse text XML 1.0 cannot represent, before it reaches a text node.

    minidom escapes `& < > " '` but happily serializes C0 control characters, which XML 1.0 forbids in
    character data (only tab, LF and CR are legal). Writing one produces a part no parser will read
    back — Excel and Word open the derived file in repair mode. This is reachable from the skill's own
    output: python-pptx maps a soft line break to \x0B, so text extracted from a deck and fed back in
    as a cell value or paragraph carries it.
    """
    for index, char in enumerate(value):
        code = ord(char)
        legal = code in (0x9, 0xA, 0xD) or 0x20 <= code <= 0xD7FF or 0xE000 <= code <= 0xFFFD or code >= 0x10000
        if not legal:
            fail(
                f"{where} contains a character XML cannot store (U+{code:04X} at offset {index}); "
                f"strip control characters — a derived file holding one will not open"
            )


def contains_doctype(data: bytes) -> bool:
    """Look for a DTD across the encodings an XML part may legally use.

    A raw `b"<!DOCTYPE" in data` only matches UTF-8/ASCII. XML also permits UTF-16 and UTF-32, where the
    same text is interleaved with null bytes — so a UTF-16 part carrying a DTD walked straight past the
    check and reached the parser with its entities intact. Decode by BOM (falling back to UTF-8) and look
    at text instead of bytes.
    """
    for bom, encoding in (
        (codecs.BOM_UTF32_LE, "utf-32-le"),
        (codecs.BOM_UTF32_BE, "utf-32-be"),
        (codecs.BOM_UTF16_LE, "utf-16-le"),
        (codecs.BOM_UTF16_BE, "utf-16-be"),
        (codecs.BOM_UTF8, "utf-8-sig"),
    ):
        if data.startswith(bom):
            return "<!DOCTYPE" in data.decode(encoding, errors="ignore")
    # No BOM: XML without one must be UTF-8, but a null-interleaved body still means UTF-16/32 was used,
    # so decoding under both keeps the check honest rather than trusting the declaration.
    if b"\x00" in data[:4]:
        return any("<!DOCTYPE" in data.decode(enc, errors="ignore") for enc in ("utf-16-le", "utf-16-be"))
    return "<!DOCTYPE" in data.decode("utf-8", errors="ignore")


def read_xml_part(archive: zipfile.ZipFile, name: str) -> bytes:
    try:
        data = archive.read(name)
    except KeyError:
        fail(f"package has no part named {name!r}")
    # OOXML parts never carry a DTD; one here can only mean entity-expansion mischief.
    if contains_doctype(data):
        fail(f"part {name!r} contains a DOCTYPE declaration; refusing to parse it")
    return data


# ── minidom helpers ──────────────────────────────────────────────────────────


def element_children(parent, local_name: str = None):
    for node in parent.childNodes:
        if node.nodeType != minidom.Node.ELEMENT_NODE:
            continue
        if local_name is None or node.tagName.rsplit(":", 1)[-1] == local_name:
            yield node


def first_child(parent, local_name: str):
    return next(element_children(parent, local_name), None)


def make_tag(sample_tag: str, local_name: str) -> str:
    """Build a tag using the same namespace prefix as a sibling/parent tag."""
    if ":" in sample_tag:
        return sample_tag.rsplit(":", 1)[0] + ":" + local_name
    return local_name


def serialize_part(doc: minidom.Document) -> bytes:
    """Serialize a part, refusing to emit anything that cannot be parsed back.

    The reparse is a structural backstop, not a formality. Character-level gates catch the cases we
    thought of one at a time — a C0 control character slipped through exactly that way. Handing the
    output back to the same parser catches the whole class mechanically: if expat cannot read it,
    neither can Excel or Word, and a derived file that opens in repair mode is the failure this
    script exists to prevent.
    """
    part = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + doc.documentElement.toxml().encode("utf-8")
    try:
        minidom.parseString(part)
    except Exception as error:  # noqa: BLE001 - any parse failure means the part is unusable
        fail(f"refusing to write a part that cannot be parsed back ({error}); this is a bug in the edit path")
    return part


# ── xlsx ─────────────────────────────────────────────────────────────────────


def resolve_rel_target(target: str) -> str:
    """Package-absolute part name for a Target declared in xl/_rels/workbook.xml.rels.

    A Target is a URI resolved against the directory holding the part that owns the .rels file, so
    `./worksheets/sheet1.xml` names the same member as the plain relative form every mainstream
    producer writes. Joined without normalizing, it yields a name no member has: the worksheet
    lookup fails on a file Excel and openpyxl both read, and drop_calc_chain leaves behind exactly
    the dangling `<Relationship>` it exists to remove.
    """
    return posixpath.normpath(target.lstrip("/") if target.startswith("/") else f"xl/{target}")


def resolve_worksheet_part(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(read_xml_part(archive, "xl/workbook.xml"))
    root_namespace = workbook.tag[1:].split("}", 1)[0] if workbook.tag.startswith("{") else ""
    reject_strict_ooxml(root_namespace, WORKBOOK_PART)
    relationship_id = None
    for sheet in workbook.iter(f"{{{SPREADSHEET_NS}}}sheet"):
        if sheet.get("name") == sheet_name:
            relationship_id = sheet.get(f"{{{RELATIONSHIP_ATTR_NS}}}id")
            break
    if relationship_id is None:
        names = [sheet.get("name") for sheet in workbook.iter(f"{{{SPREADSHEET_NS}}}sheet")]
        fail(f"worksheet not found: {sheet_name!r} (has: {names})")

    rels = ET.fromstring(read_xml_part(archive, "xl/_rels/workbook.xml.rels"))
    for relationship in rels.iter(f"{{{PACKAGE_RELS_NS}}}Relationship"):
        if relationship.get("Id") == relationship_id:
            return resolve_rel_target(relationship.get("Target", ""))
    fail(f"workbook relationship {relationship_id!r} not found")
    raise AssertionError  # unreachable


def drop_calc_chain(archive: zipfile.ZipFile) -> dict[str, bytes]:
    """Rewrite the two parts that declare xl/calcChain.xml so it can be left out of the copy.

    calcChain records the calculation order of every formula cell. Leaving an entry for a cell
    whose formula we just replaced with a literal makes Excel report the derived file as corrupt
    and "repair" it on open. The part is a pure recalculation cache that Excel rebuilds on its
    own, so dropping it whole is the safe move — but a dangling <Override> or <Relationship>
    pointing at a missing part triggers the same repair prompt, hence these two edits.
    """
    content_types = minidom.parseString(read_xml_part(archive, CONTENT_TYPES_PART))
    for override in list(element_children(content_types.documentElement, "Override")):
        if override.getAttribute("PartName") == f"/{CALC_CHAIN_PART}":
            override.parentNode.removeChild(override)

    rels = minidom.parseString(read_xml_part(archive, WORKBOOK_RELS_PART))
    for relationship in list(element_children(rels.documentElement, "Relationship")):
        if resolve_rel_target(relationship.getAttribute("Target")) == CALC_CHAIN_PART:
            relationship.parentNode.removeChild(relationship)

    return {CONTENT_TYPES_PART: serialize_part(content_types), WORKBOOK_RELS_PART: serialize_part(rels)}


# Children CT_Workbook orders after <calcPr>. The sequence is ordered, so a calcPr appended at the
# end lands behind one of these and Excel opens the file in repair mode.
AFTER_CALC_PR = {
    "oleSize",
    "customWorkbookViews",
    "pivotCaches",
    "smartTagPr",
    "smartTagTypes",
    "webPublishing",
    "fileRecoveryPr",
    "webPublishObjects",
    "extLst",
}


def request_full_recalc(archive: zipfile.ZipFile) -> dict[str, bytes]:
    """Set calcPr/@fullCalcOnLoad, so Excel recomputes the formulas that read an edited cell.

    A formula cell stores its expression and the value Excel last computed for it. Writing a cell
    does not touch the cached values of the formulas reading it, and Excel recalculates on open only
    when the file asks — otherwise it trusts the caches and shows the stale numbers. Dropping
    calcChain.xml is not a substitute: that part is the order a recalculation would run in, not a
    request to run one. Verified: with it dropped, a dependent cell still read back its old value.
    openpyxl sets this same flag on every write.
    """
    workbook = minidom.parseString(read_xml_part(archive, WORKBOOK_PART))
    root = workbook.documentElement
    calc_pr = first_child(root, "calcPr")
    if calc_pr is None:
        calc_pr = workbook.createElement(make_tag(root.tagName, "calcPr"))
        before = next(
            (child for child in element_children(root) if child.tagName.rsplit(":", 1)[-1] in AFTER_CALC_PR),
            None,
        )
        root.insertBefore(calc_pr, before)
    calc_pr.setAttribute("fullCalcOnLoad", "1")
    return {WORKBOOK_PART: serialize_part(workbook)}


def reject_shared_formula(formula, ref: str) -> None:
    """Refuse a cell whose formula is shared with cells we are not editing.

    A shared-formula master (`<f t="shared" ref="B2:B4" si="0">`) is the only place the expression is
    stored; its followers carry just `si`. Deleting either one silently guts cells the caller never
    named — openpyxl reads the orphans back as a bare "=" — so this is a refusal, not a repair.
    Array and data-table groups are handled by `grouped_formula_ranges` instead: their followers carry
    no `<f>` at all, so there is nothing here to inspect.
    """
    if formula.getAttribute("t") != "shared":
        return
    group = formula.getAttribute("ref")
    scope = f"covering {group}" if group else f"in shared group si={formula.getAttribute('si')!r}"
    fail(
        f"cell {ref} holds a shared formula {scope}; overwriting it would strip the formula from the "
        f"other cells in that group. Rewrite the whole range with a library "
        f"(`uv run --with openpyxl python`) instead of patch-copy."
    )


def merged_ranges(worksheet) -> list[tuple[str, tuple[int, int, int, int]]]:
    """Every <mergeCell> range, as (ref, (min_col, min_row, max_col, max_row)).

    Only the top-left cell of a merge is displayed; writing any other cell in the range puts a value
    into the file that Excel will never show. Worse, `office_extract.py` reads with `read_only=True`,
    which does not mask merge followers — so the skill's own "edit, then extract to verify" loop would
    read the value back and confirm a write the user cannot see.
    """
    ranges = []
    container = first_child(worksheet, "mergeCells")
    if container is None:
        return ranges
    for merge in element_children(container, "mergeCell"):
        ref = merge.getAttribute("ref")
        if not ref:
            continue
        corners = [parse_a1_cell(part) for part in ref.split(":")]
        cols = [column for column, _ in corners]
        rows = [row_number for _, row_number in corners]
        ranges.append((ref, (min(cols), min(rows), max(cols), max(rows))))
    return ranges


GROUPED_FORMULA_KINDS = {"array": "array formula", "dataTable": "data table"}


def grouped_formula_ranges(sheet_data) -> list[tuple[str, str, tuple[int, int, int, int]]]:
    """Every range owned by an array or data-table formula, as (kind, ref, (min_col, min_row, max_col, max_row)).

    Only the master cell of an array formula carries `<f t="array" ref="...">`; the cells it spills
    into hold a plain `<v>` and nothing else. Inspecting the edited cell therefore cannot tell you it
    belongs to an array — the range has to be collected up front and the coordinate tested against it.

    A data table (`<f t="dataTable" ref="...">`, Excel's What-If analysis) is the fourth member of the
    same `t` enum and stores its grid the same way, so it is collected here too. Left out, writing the
    master deletes the one `<f>` that defines the whole grid and leaves its other cells as orphan
    literals — a write naming one cell quietly changing several.
    """
    ranges = []
    for row in element_children(sheet_data, "row"):
        for cell in element_children(row, "c"):
            formula = first_child(cell, "f")
            if formula is None:
                continue
            kind = GROUPED_FORMULA_KINDS.get(formula.getAttribute("t"))
            if kind is None:
                continue
            ref = formula.getAttribute("ref")
            if not ref:
                continue
            corners = [parse_a1_cell(part) for part in ref.split(":")]
            cols = [column for column, _ in corners]
            rows = [row_number for _, row_number in corners]
            ranges.append((kind, ref, (min(cols), min(rows), max(cols), max(rows))))
    return ranges


def set_cell_value(doc: minidom.Document, cell, value) -> None:
    for child in list(cell.childNodes):
        cell.removeChild(child)
    if cell.hasAttribute("t"):
        cell.removeAttribute("t")
    if isinstance(value, bool):
        cell.setAttribute("t", "b")
        v = doc.createElement(make_tag(cell.tagName, "v"))
        v.appendChild(doc.createTextNode("1" if value else "0"))
        cell.appendChild(v)
    elif isinstance(value, (int, float)):
        # json.loads accepts NaN/Infinity/-Infinity literals, and 1e999 overflows to inf on its own.
        # repr() spells those "nan"/"inf", which are well-formed XML but not valid xsd:double, so the
        # reparse backstop cannot catch them — the workbook simply stops opening.
        if not math.isfinite(value):
            fail(
                f"cell {cell.getAttribute('r') or '?'} was given {value!r}, which a spreadsheet cannot "
                f"store; use a finite number, or a string if the cell should show text"
            )
        v = doc.createElement(make_tag(cell.tagName, "v"))
        v.appendChild(doc.createTextNode(repr(value)))
        cell.appendChild(v)
    elif isinstance(value, str):
        reject_invalid_xml_text(value, f"cell {cell.getAttribute('r') or '?'}")
        cell.setAttribute("t", "inlineStr")
        inline = doc.createElement(make_tag(cell.tagName, "is"))
        text = doc.createElement(make_tag(cell.tagName, "t"))
        text.setAttribute("xml:space", "preserve")
        text.appendChild(doc.createTextNode(value))
        inline.appendChild(text)
        cell.appendChild(inline)
    else:
        fail(f"unsupported cell value type: {type(value).__name__} (use number, string, or boolean)")


def find_or_create_ordered(doc: minidom.Document, parent, local_name: str, sort_key, key, attr_ref: str):
    """Find child with attribute r == attr_ref, or insert one keeping siblings ordered."""
    siblings = list(element_children(parent, local_name))
    for child in siblings:
        if child.getAttribute("r") == attr_ref:
            return child
    # An r-less sibling's position is inferred from document order, so inserting a
    # referenced element beside it could address the same cell twice. Refuse rather
    # than risk a corrupt derived file.
    if any(not child.hasAttribute("r") for child in siblings):
        fail(f"worksheet has {local_name} elements without 'r' attributes; refusing to edit this workbook")
    created = doc.createElement(siblings[0].tagName if siblings else make_tag(parent.tagName, local_name))
    created.setAttribute("r", attr_ref)
    before = None
    for child in siblings:
        if sort_key(child.getAttribute("r")) > key:
            before = child
            break
    # Past the last sibling is not the same as last in the parent: CT_Row puts `extLst` after every
    # `c`, so appending a cell whose column is the highest yet would land behind it and Excel opens
    # the file in repair mode. Only `extLst` follows in either sequence this creates into.
    if before is None:
        before = first_child(parent, "extLst")
    parent.insertBefore(created, before)
    return created


def update_dimension(worksheet, edited: list[tuple[int, int]]) -> None:
    """Widen <dimension> to cover created cells so the used range stays truthful."""
    dimension = first_child(worksheet, "dimension")
    if dimension is None:
        return
    ref = dimension.getAttribute("ref")
    parts = ref.split(":") if ref else []
    corners = [A1_CELL_RE.match(part) for part in parts]
    if not corners or not all(corners):
        return  # unrecognized existing ref; leave it untouched
    cols = [column_to_index(match.group(1)) for match in corners] + [col for col, _ in edited]
    rows = [int(match.group(2)) for match in corners] + [row for _, row in edited]
    start = f"{index_to_column(min(cols))}{min(rows)}"
    end = f"{index_to_column(max(cols))}{max(rows)}"
    dimension.setAttribute("ref", start if start == end else f"{start}:{end}")


def patch_xlsx(archive: zipfile.ZipFile, edits: dict) -> tuple[dict[str, bytes], set[str]]:
    sheet_name = edits.get("sheet")
    cells = edits.get("cells")
    if not sheet_name or not isinstance(cells, dict) or not cells:
        fail("xlsx edits require 'sheet' and a non-empty 'cells' object")

    part_name = resolve_worksheet_part(archive, sheet_name)
    doc = minidom.parseString(read_xml_part(archive, part_name))
    worksheet = doc.documentElement
    sheet_data = first_child(worksheet, "sheetData")
    if sheet_data is None:
        fail(f"{part_name} has no sheetData element")

    grouped_ranges = grouped_formula_ranges(sheet_data)
    merges = merged_ranges(worksheet)

    edited: list[tuple[int, int]] = []
    replaced_formula = False
    for ref, value in sorted(cells.items(), key=lambda item: (parse_a1_cell(item[0])[1], parse_a1_cell(item[0])[0])):
        column, row_number = parse_a1_cell(ref)
        for merge_ref, (min_col, min_row, max_col, max_row) in merges:
            if min_col <= column <= max_col and min_row <= row_number <= max_row and (column, row_number) != (min_col, min_row):
                fail(
                    f"cell {ref} is covered by the merge {merge_ref}; only its top-left cell is ever "
                    f"displayed, so this write would be invisible in Excel. Target "
                    f"{index_to_column(min_col)}{min_row} instead."
                )
        for kind, group_ref, (min_col, min_row, max_col, max_row) in grouped_ranges:
            if min_col <= column <= max_col and min_row <= row_number <= max_row:
                fail(
                    f"cell {ref} sits inside the {kind} covering {group_ref}; that range is computed as "
                    f"a unit, so writing one of its cells leaves the range inconsistent. "
                    f"Rewrite it with a library (`uv run --with openpyxl python`) instead of patch-copy."
                )
        row = find_or_create_ordered(doc, sheet_data, "row", lambda r: int(r), row_number, str(row_number))
        cell = find_or_create_ordered(doc, row, "c", lambda r: parse_a1_cell(r)[0], column, ref)
        formula = first_child(cell, "f")
        if formula is not None:
            reject_shared_formula(formula, ref)
            replaced_formula = True
        set_cell_value(doc, cell, value)
        edited.append((column, row_number))
    update_dimension(worksheet, edited)

    replaced = {part_name: serialize_part(doc), **request_full_recalc(archive)}
    dropped: set[str] = set()
    if replaced_formula and CALC_CHAIN_PART in archive.namelist():
        replaced.update(drop_calc_chain(archive))
        dropped.add(CALC_CHAIN_PART)
    return replaced, dropped


# ── docx ─────────────────────────────────────────────────────────────────────


# Inline markers whose meaning lives outside the paragraph: bookmarks, comment anchors and fields all
# pair a start with an end that may sit in a different paragraph. Flattening the paragraph deletes one
# half and leaves the document with an unmatched marker, so these are refused rather than dropped.
WORDPROCESSING_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# What the rewrite emits, in full:  w:p > [w:pPr] + w:r > [w:rPr] + w:t
#
# So the only children that survive it are the ones that shape can carry. This is an ALLOW-list, not
# a list of dangerous elements, because the dangerous set cannot be enumerated: ECMA-376 Part 3
# (Markup Compatibility) exists precisely so consumers meet elements they do not know, w:extLst is an
# open extension channel by design, and Microsoft keeps adding namespaces (w14, w15, w16*, ink, 3D,
# SVG). Three review rounds of "enumerate what is dangerous" each missed a new batch. Inverting the
# default means an element nobody has heard of yet lands on the refusing side, and the only thing we
# must get right is whether these thirteen are truly lossless — a closed, checkable question.
PARAGRAPH_ALLOWED = {
    (WORDPROCESSING_NS, "pPr"),  # kept verbatim, never descended into
    (WORDPROCESSING_NS, "r"),  # the run being replaced
    (WORDPROCESSING_NS, "proofErr"),  # spell/grammar marker, no semantics, Word regenerates it
}

# Inside the run: the text and its typographic separators. tab, br, cr and ptab are the old text and
# losing them is the edit's intent — reject_break_characters is what makes that true rather than
# merely hoped for, since an extract shows them as \t or \n and writing one back is refused outright.
# lastRenderedPageBreak needs no such argument: Word discards and recomputes it on open.
#
# softHyphen and noBreakHyphen are the honest exceptions. Neither reaches the caller intact — a soft
# hyphen leaves no mark in the extracted text at all, and a no-break hyphen reads as a plain "-" that
# writing back downgrades it to — so their loss is not chosen, it is accepted. What is lost is where
# a line may break, never a character. Refusing them instead would strand the paragraph: the run-level
# recipe cannot rebuild them either, so both routes this skill offers would be closed.
#
# w:sym is where that trade stops. Its glyph lives in w:font/w:char and vanishes from the extract the
# same way, but what goes missing is a character the reader can see, not a hyphenation hint.
RUN_ALLOWED = {
    (WORDPROCESSING_NS, name)
    for name in ("rPr", "t", "tab", "br", "cr", "ptab", "softHyphen", "noBreakHyphen", "lastRenderedPageBreak")
}

# Friendlier names for what we expect to meet; anything absent is reported by its qualified name.
CONTENT_DESCRIPTIONS = {
    (WORDPROCESSING_NS, "bookmarkStart"): "a bookmark",
    (WORDPROCESSING_NS, "bookmarkEnd"): "a bookmark",
    (WORDPROCESSING_NS, "commentRangeStart"): "a comment anchor",
    (WORDPROCESSING_NS, "commentRangeEnd"): "a comment anchor",
    (WORDPROCESSING_NS, "commentReference"): "a comment",
    (WORDPROCESSING_NS, "permStart"): "an editing-permission range",
    (WORDPROCESSING_NS, "permEnd"): "an editing-permission range",
    (WORDPROCESSING_NS, "fldSimple"): "a field",
    (WORDPROCESSING_NS, "fldChar"): "a field",
    (WORDPROCESSING_NS, "instrText"): "a field",
    (WORDPROCESSING_NS, "hyperlink"): "a hyperlink",
    (WORDPROCESSING_NS, "drawing"): "an image",
    (WORDPROCESSING_NS, "pict"): "an image",
    (WORDPROCESSING_NS, "object"): "an embedded object",
    (WORDPROCESSING_NS, "footnoteReference"): "a footnote reference",
    (WORDPROCESSING_NS, "endnoteReference"): "an endnote reference",
    (WORDPROCESSING_NS, "ins"): "a tracked insertion",
    (WORDPROCESSING_NS, "del"): "a tracked deletion",
    (WORDPROCESSING_NS, "moveFrom"): "a tracked move",
    (WORDPROCESSING_NS, "moveTo"): "a tracked move",
    (WORDPROCESSING_NS, "sdt"): "a content control",
    (WORDPROCESSING_NS, "smartTag"): "a smart tag",
    (WORDPROCESSING_NS, "subDoc"): "a subdocument reference",
    (WORDPROCESSING_NS, "sym"): "a symbol character",
    ("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMath"): "an equation",
    ("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMathPara"): "an equation",
}


def local_name(element) -> str:
    return element.tagName.rsplit(":", 1)[-1]


def resolve_namespace(element) -> str:
    """Namespace URI for an element, resolved through the xmlns declarations in scope.

    `minidom.parseString` is not namespace-aware, so `element.namespaceURI` is always None and only
    the literal prefix survives. Matching on the prefix would be wrong in both directions: a document
    may bind `w:` to something else, and it may bind WordprocessingML to a different prefix. It also
    conflates namespaces that share a local name — `m:t` (equation text) would pass a bare "t" check.
    """
    prefix = element.tagName.rsplit(":", 1)[0] if ":" in element.tagName else ""
    declaration = f"xmlns:{prefix}" if prefix else "xmlns"
    node = element
    while node is not None and node.nodeType == minidom.Node.ELEMENT_NODE:
        if node.hasAttribute(declaration):
            return node.getAttribute(declaration)
        node = node.parentNode
    return ""


def describe_element(key: tuple[str, str], element) -> str:
    if key in CONTENT_DESCRIPTIONS:
        return CONTENT_DESCRIPTIONS[key]
    return f"<{element.tagName}>"


def reject_unrepresentable_content(paragraph, index: int) -> None:
    """Refuse a paragraph holding anything the rewrite's output shape cannot carry.

    `pPr` is deliberately not descended into: it survives the rewrite untouched, so its contents are
    never at risk — descending was what made revision marks on the paragraph mark itself (pPr/rPr/w:ins)
    a false refusal.
    """
    for child in element_children(paragraph):
        key = (resolve_namespace(child), local_name(child))
        if key not in PARAGRAPH_ALLOWED:
            fail(
                f"paragraph {index} contains {describe_element(key, child)}, which this rewrite cannot "
                f"keep: it emits one plain run, so everything else in the paragraph would be deleted — "
                f"and a start marker whose matching end lives in another paragraph would leave the "
                f"document unbalanced. See \"Edit docx\" in SKILL.md for a run-level edit that "
                f"preserves inline structure, or target a paragraph without it."
            )
        if key != (WORDPROCESSING_NS, "r"):
            continue
        for grandchild in element_children(child):
            grandkey = (resolve_namespace(grandchild), local_name(grandchild))
            if grandkey not in RUN_ALLOWED:
                fail(
                    f"paragraph {index} has a run containing {describe_element(grandkey, grandchild)}, "
                    f"which this rewrite cannot keep: the replacement run carries text and character "
                    f"formatting only. See \"Edit docx\" in SKILL.md for a run-level edit that "
                    f"preserves inline structure."
                )


def reject_break_characters(text: str, index: int) -> None:
    """Refuse tab, newline and CR in docx replacement text, which one `<w:t>` cannot represent.

    WordprocessingML spells a tab `<w:tab/>` and a line break `<w:br/>` — separate elements, not
    characters. Translating rather than refusing would be a guess, because the mapping is not
    reversible: `w:br`, `w:cr` and a page break all read back as the same newline. This is reachable
    from the skill's own round trip, where it is also silent — extracting a paragraph that holds a
    real `w:tab` or `w:br` yields those characters, and writing the edited string back drops the
    elements while the text still reads the same.

    Only docx goes through here. `reject_invalid_xml_text` stays as it is: an xlsx inline string is
    where a newline legitimately means a line break inside the cell.
    """
    for name, char in (("a tab", "\t"), ("a line break", "\n"), ("a carriage return", "\r")):
        if char in text:
            fail(
                f"replacement text for paragraph {index} contains {name}, which this rewrite cannot "
                f'represent: it emits one <w:t>, while WordprocessingML spells these as <w:tab/> and '
                f'<w:br/> elements. Split the content across separate body paragraphs, or see '
                f'"Edit docx" in SKILL.md for a run-level edit.'
            )


def patch_docx(archive: zipfile.ZipFile, edits: dict) -> tuple[dict[str, bytes], set[str]]:
    replacements = edits.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        fail("docx edits require a non-empty 'replacements' array")

    doc = minidom.parseString(read_xml_part(archive, "word/document.xml"))
    reject_strict_ooxml(resolve_namespace(doc.documentElement), "word/document.xml")
    body = first_child(doc.documentElement, "body")
    if body is None:
        fail("word/document.xml has no body element")
    paragraphs = list(element_children(body, "p"))

    for replacement in replacements:
        if not isinstance(replacement, dict):
            fail(f"each replacement must be an object with 'paragraph' and 'text': {replacement!r}")
        index = replacement.get("paragraph")
        text = replacement.get("text")
        if index is None or not isinstance(text, str):
            fail(f"each replacement needs a non-negative 'paragraph' and string 'text': {replacement!r}")
        # int() would take "3", 3.7 or True and rewrite a paragraph the caller never named.
        if isinstance(index, bool) or not isinstance(index, int):
            fail(f"replacement 'paragraph' must be an integer, not {type(index).__name__}: {index!r}")
        if index < 0:
            fail(f"replacement 'paragraph' must be >= 0: {index!r}")
        if index >= len(paragraphs):
            fail(f"paragraph {index} out of range (document has {len(paragraphs)} body paragraphs)")
        paragraph = paragraphs[index]

        reject_invalid_xml_text(text, f"replacement text for paragraph {index}")
        reject_break_characters(text, index)
        reject_unrepresentable_content(paragraph, index)

        properties = first_child(paragraph, "pPr")
        first_run = first_child(paragraph, "r")
        first_run_properties = first_child(first_run, "rPr") if first_run is not None else None

        for child in list(paragraph.childNodes):
            if child is not properties:
                paragraph.removeChild(child)
        run = doc.createElement(make_tag(paragraph.tagName, "r"))
        if first_run_properties is not None:
            run.appendChild(first_run_properties)
        text_element = doc.createElement(make_tag(paragraph.tagName, "t"))
        text_element.setAttribute("xml:space", "preserve")
        text_element.appendChild(doc.createTextNode(text))
        run.appendChild(text_element)
        paragraph.appendChild(run)

    return {"word/document.xml": serialize_part(doc)}, set()


PATCHERS = {"xlsx": patch_xlsx, "docx": patch_docx}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="absolute path of the source document (read-only)")
    parser.add_argument("--edits", required=True, help="edit JSON — see module docstring for shapes")
    parser.add_argument("--out", required=True, help="absolute path of the NEW file to create; must not exist")
    args = parser.parse_args()

    src = Path(args.file)
    out_path = Path(args.out)
    # Both paths are documented, and schema-validated upstream, as absolute. Accepting a relative one
    # silently resolves it against whatever working directory the agent happens to be in.
    for label, candidate in (("--file", src), ("--out", out_path)):
        if not candidate.is_absolute():
            fail(f"{label} must be an absolute path: {str(candidate)!r}")
    if not src.is_file():
        fail(f"source file not found: {src}")
    if out_path.resolve() == src.resolve():
        fail("output path must differ from the source file — the source is never modified")
    if out_path.exists():
        fail(f"output path already exists: {out_path} — pick a fresh name instead of overwriting")

    try:
        edits = json.loads(args.edits)
    except json.JSONDecodeError as error:
        fail(f"edits is not valid JSON: {error}")
    # `null` and `[]` parse fine and then fail on .get() with a traceback, which reads to the caller
    # as a broken script rather than a bad argument. An unhashable "format" — a list or a dict —
    # does the same on the lookup below, so it takes the same route to the same message.
    if not isinstance(edits, dict):
        fail(f"edits must be a JSON object, not {type(edits).__name__}: {edits!r}")
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
