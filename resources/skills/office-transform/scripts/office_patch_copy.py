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
    {"format": "docx", "replacements": [{"paragraph": 3, "text": "new text",
                                          "paraId": "502E8D33", "expectText": "old text"}]}

xlsx: each cell is overwritten with the JSON value (number, string, or
boolean); an existing formula in that cell is replaced by the value. The
worksheet's <dimension> is widened when edits create cells outside it.
docx: 'paragraph' is the zero-based ordinal among BODY-LEVEL paragraphs
(direct w:body children; tables excluded). Optional 'paraId' (w14:paraId) is
resolved first when present; a paraId that resolves to a different paragraph
than the ordinal is an error, never a silent pick. Optional 'expectText' is a
hard gate: the target paragraph's current text (whitespace-normalized) must
equal it or the edit is refused — take its value from a prior extract of the
anchor, not from a selection-ref excerpt. The paragraph keeps its paragraph
style and the first run's character style, but other inline content (extra
run styling, hyperlinks) inside that one paragraph is flattened into the
new text.
"""

import argparse
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.dom import minidom

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_ATTR_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

A1_CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")

MAX_ZIP_ENTRIES = 10_000
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


def fail(message: str) -> "sys.NoReturn":
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


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
    return column_to_index(match.group(1)), int(match.group(2))


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


def read_xml_part(archive: zipfile.ZipFile, name: str) -> bytes:
    try:
        data = archive.read(name)
    except KeyError:
        fail(f"package has no part named {name!r}")
    # OOXML parts never carry a DTD; one here can only mean entity-expansion mischief.
    if b"<!DOCTYPE" in data:
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


def normalize_text(text: str) -> str:
    """Mirror of the renderer's normalizeSelectionText: NFC, collapse whitespace, trim."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def paragraph_para_id(paragraph) -> str:
    attrs = paragraph.attributes
    if attrs is not None:
        for i in range(attrs.length):
            attr = attrs.item(i)
            if attr.name.rsplit(":", 1)[-1] == "paraId":
                return attr.value
    return None


def paragraph_text(paragraph) -> str:
    parts = []

    def walk(node):
        for child in node.childNodes:
            if child.nodeType == minidom.Node.ELEMENT_NODE:
                if child.tagName.rsplit(":", 1)[-1] == "t":
                    parts.append("".join(t.data for t in child.childNodes if t.nodeType == minidom.Node.TEXT_NODE))
                else:
                    walk(child)

    walk(paragraph)
    return "".join(parts)


def serialize_part(doc: minidom.Document) -> bytes:
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + doc.documentElement.toxml().encode("utf-8")


# ── xlsx ─────────────────────────────────────────────────────────────────────


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
            target = relationship.get("Target", "")
            return target.lstrip("/") if target.startswith("/") else f"xl/{target}"
    fail(f"workbook relationship {relationship_id!r} not found")
    raise AssertionError  # unreachable


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


def patch_xlsx(archive: zipfile.ZipFile, edits: dict) -> dict[str, bytes]:
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

    edited: list[tuple[int, int]] = []
    for ref, value in sorted(cells.items(), key=lambda item: (parse_a1_cell(item[0])[1], parse_a1_cell(item[0])[0])):
        column, row_number = parse_a1_cell(ref)
        row = find_or_create_ordered(doc, sheet_data, "row", lambda r: int(r), row_number, str(row_number))
        cell = find_or_create_ordered(doc, row, "c", lambda r: parse_a1_cell(r)[0], column, ref)
        set_cell_value(doc, cell, value)
        edited.append((column, row_number))
    update_dimension(worksheet, edited)

    return {part_name: serialize_part(doc)}


# ── docx ─────────────────────────────────────────────────────────────────────


def patch_docx(archive: zipfile.ZipFile, edits: dict) -> dict[str, bytes]:
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
        if index is None or int(index) < 0 or not isinstance(text, str):
            fail(f"each replacement needs a non-negative 'paragraph' and string 'text': {replacement!r}")
        index = int(index)
        if index >= len(paragraphs):
            fail(f"paragraph {index} out of range (document has {len(paragraphs)} body paragraphs)")
        paragraph = paragraphs[index]

        para_id = replacement.get("paraId")
        if para_id:
            matches = [p for p in paragraphs if paragraph_para_id(p) == para_id]
            if len(matches) > 1:
                fail(f"paraId {para_id!r} matches {len(matches)} paragraphs; refusing an ambiguous edit")
            if matches and matches[0] is not paragraph:
                fail(
                    f"paraId {para_id!r} and paragraph {index} point at different paragraphs — "
                    "the document changed since the anchor was captured; re-select instead of guessing"
                )
            if matches:
                paragraph = matches[0]

        expect_text = replacement.get("expectText")
        if expect_text is not None:
            current = normalize_text(paragraph_text(paragraph))
            if normalize_text(expect_text) != current:
                fail(
                    f"expectText mismatch for paragraph {index}: the paragraph now reads {current[:120]!r} — "
                    "the anchor no longer matches; re-extract and re-select instead of editing blind"
                )

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

    return {"word/document.xml": serialize_part(doc)}


PATCHERS = {"xlsx": patch_xlsx, "docx": patch_docx}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="absolute path of the source document (read-only)")
    parser.add_argument("--edits", required=True, help="edit JSON — see module docstring for shapes")
    parser.add_argument("--out", required=True, help="absolute path of the NEW file to create; must not exist")
    args = parser.parse_args()

    src = Path(args.file)
    out_path = Path(args.out)
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
    with zipfile.ZipFile(src) as archive:
        preflight_zip(archive)
        replaced_parts = patcher(archive, edits)
        with zipfile.ZipFile(out_path, "w") as derived:
            for item in archive.infolist():
                data = replaced_parts.get(item.filename, None)
                if data is None:
                    data = archive.read(item.filename)
                derived.writestr(item, data, compress_type=item.compress_type)
    print(str(out_path))


if __name__ == "__main__":
    main()
