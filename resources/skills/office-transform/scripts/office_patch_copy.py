#!/usr/bin/env python3
"""Derive a new .xlsx/.docx by copying the original package and rewriting only
the XML parts the requested edits touch.

OOXML files are ZIP packages of XML parts. This script copies every part of
the original byte-for-byte and re-serializes ONLY the affected part (one
worksheet, or word/document.xml), so fidelity risk is confined to that part.
The touched part is manipulated with xml.dom.minidom, which round-trips
namespace prefixes and declarations verbatim (unlike ElementTree, which
rewrites unknown prefixes and breaks mc:Ignorable references). The source
file is never modified. Standard library only — no dependencies.

Edit JSON shapes (pass via --edits):

    {"format": "xlsx", "sheet": "Sheet1", "cells": {"B2": 42, "C3": "hello", "D4": true}}
    {"format": "docx", "replacements": [{"paragraph": 3, "text": "new text"}]}

xlsx: each cell is overwritten with the JSON value (number, string, or
boolean); an ordinary formula in that cell is replaced by the value, while a
cell belonging to a shared or array formula group is refused (see
reject_grouped_formula). The worksheet's <dimension> is widened when edits
create cells outside it. Replacing a formula also drops xl/calcChain.xml (see
drop_calc_chain); that and [Content_Types].xml / workbook.xml.rels are the only
parts besides the edited worksheet this script ever rewrites.
docx: 'paragraph' is the zero-based ordinal among BODY-LEVEL paragraphs
(direct w:body children; tables excluded); the paragraph keeps its paragraph
style and the first run's character style, and extra run-level styling is
flattened into the new text. Paragraphs holding bookmarks, comment anchors,
fields or hyperlinks are refused (see reject_semantic_inline_content) because
their markers can pair across paragraphs.

The output is written to a staging file and renamed on success, so a failure
never leaves a partial package behind (see atomic_output).
"""

import argparse
import codecs
import contextlib
import json
import os
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

A1_CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")

CONTENT_TYPES_PART = "[Content_Types].xml"
WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels"
CALC_CHAIN_PART = "xl/calcChain.xml"

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


@contextlib.contextmanager
def atomic_output(out_path: Path):
    """Yield a staging path in the destination directory, renamed onto `out_path` only on success.

    Nothing partial ever appears at the destination: a failure removes the staging file, so the same
    command can be retried without tripping the "output path already exists" check.
    """
    handle, staging_name = tempfile.mkstemp(dir=out_path.parent, prefix=f".{out_path.name}.", suffix=".part")
    os.close(handle)
    staging = Path(staging_name)
    try:
        yield staging
        staging.replace(out_path)
    except BaseException:
        staging.unlink(missing_ok=True)
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
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + doc.documentElement.toxml().encode("utf-8")


# ── xlsx ─────────────────────────────────────────────────────────────────────


def resolve_rel_target(target: str) -> str:
    """Package-absolute part name for a Target declared in xl/_rels/workbook.xml.rels."""
    return target.lstrip("/") if target.startswith("/") else f"xl/{target}"


def resolve_worksheet_part(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(read_xml_part(archive, "xl/workbook.xml"))
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


def reject_shared_formula(formula, ref: str) -> None:
    """Refuse a cell whose formula is shared with cells we are not editing.

    A shared-formula master (`<f t="shared" ref="B2:B4" si="0">`) is the only place the expression is
    stored; its followers carry just `si`. Deleting either one silently guts cells the caller never
    named — openpyxl reads the orphans back as a bare "=" — so this is a refusal, not a repair.
    Array groups are handled by `array_formula_ranges` instead: their followers carry no `<f>` at all,
    so there is nothing here to inspect.
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


def array_formula_ranges(sheet_data) -> list[tuple[str, tuple[int, int, int, int]]]:
    """Every range owned by an array formula, as (ref, (min_col, min_row, max_col, max_row)).

    Only the master cell of an array formula carries `<f t="array" ref="...">`; the cells it spills
    into hold a plain `<v>` and nothing else. Inspecting the edited cell therefore cannot tell you it
    belongs to an array — the range has to be collected up front and the coordinate tested against it.
    """
    ranges = []
    for row in element_children(sheet_data, "row"):
        for cell in element_children(row, "c"):
            formula = first_child(cell, "f")
            if formula is None or formula.getAttribute("t") != "array":
                continue
            ref = formula.getAttribute("ref")
            if not ref:
                continue
            corners = [parse_a1_cell(part) for part in ref.split(":")]
            cols = [column for column, _ in corners]
            rows = [row_number for _, row_number in corners]
            ranges.append((ref, (min(cols), min(rows), max(cols), max(rows))))
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

    array_ranges = array_formula_ranges(sheet_data)

    edited: list[tuple[int, int]] = []
    replaced_formula = False
    for ref, value in sorted(cells.items(), key=lambda item: (parse_a1_cell(item[0])[1], parse_a1_cell(item[0])[0])):
        column, row_number = parse_a1_cell(ref)
        for array_ref, (min_col, min_row, max_col, max_row) in array_ranges:
            if min_col <= column <= max_col and min_row <= row_number <= max_row:
                fail(
                    f"cell {ref} sits inside the array formula covering {array_ref}; an array range is "
                    f"computed as a unit, so writing one of its cells leaves the range inconsistent. "
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

    replaced = {part_name: serialize_part(doc)}
    dropped: set[str] = set()
    if replaced_formula and CALC_CHAIN_PART in archive.namelist():
        replaced.update(drop_calc_chain(archive))
        dropped.add(CALC_CHAIN_PART)
    return replaced, dropped


# ── docx ─────────────────────────────────────────────────────────────────────


# Inline markers whose meaning lives outside the paragraph: bookmarks, comment anchors and fields all
# pair a start with an end that may sit in a different paragraph. Flattening the paragraph deletes one
# half and leaves the document with an unmatched marker, so these are refused rather than dropped.
SEMANTIC_INLINE_TAGS = {
    "bookmarkStart": "a bookmark",
    "bookmarkEnd": "a bookmark",
    "commentRangeStart": "a comment anchor",
    "commentRangeEnd": "a comment anchor",
    "fldSimple": "a field",
    "fldChar": "a field",
    "instrText": "a field",
    "hyperlink": "a hyperlink",
    # Content the rewrite would drop outright rather than flatten: the loop below keeps only pPr, so
    # anything the new run cannot carry disappears with no trace in the text-only verification the
    # skill performs afterwards. A dropped w:del is the worst of these — it silently accepts a
    # pending tracked deletion.
    "drawing": "an image",
    "pict": "an image",
    "object": "an embedded object",
    "footnoteReference": "a footnote reference",
    "endnoteReference": "an endnote reference",
    "ins": "a tracked insertion",
    "del": "a tracked deletion",
}


def reject_semantic_inline_content(paragraph, index: int) -> None:
    """Refuse to flatten a paragraph that carries inline content this rewrite cannot preserve."""
    found = {}

    def walk(node) -> None:
        for child in element_children(node):
            local_name = child.tagName.rsplit(":", 1)[-1]
            if local_name in SEMANTIC_INLINE_TAGS:
                found.setdefault(SEMANTIC_INLINE_TAGS[local_name], local_name)
            walk(child)

    walk(paragraph)
    if not found:
        return
    described = ", ".join(sorted(found))
    fail(
        f"paragraph {index} contains {described}, which this rewrite would delete rather than keep "
        f"(and a start marker whose matching end lives in another paragraph would leave the document "
        f"unbalanced). Edit it with python-docx (`uv run --with python-docx python`), which preserves "
        f"inline structure, or target a paragraph without these markers."
    )


def patch_docx(archive: zipfile.ZipFile, edits: dict) -> tuple[dict[str, bytes], set[str]]:
    replacements = edits.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        fail("docx edits require a non-empty 'replacements' array")

    doc = minidom.parseString(read_xml_part(archive, "word/document.xml"))
    body = first_child(doc.documentElement, "body")
    if body is None:
        fail("word/document.xml has no body element")
    paragraphs = list(element_children(body, "p"))

    for replacement in replacements:
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
        reject_semantic_inline_content(paragraph, index)

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
    patcher = PATCHERS.get(edits.get("format"))
    if patcher is None:
        fail(f"unsupported edits format: {edits.get('format')!r} (use xlsx or docx)")

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
