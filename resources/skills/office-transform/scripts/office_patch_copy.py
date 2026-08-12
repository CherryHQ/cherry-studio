#!/usr/bin/env python3
"""Derive a new .xlsx/.docx by copying the original package and rewriting only
the XML parts the requested edits touch.

OOXML files are ZIP packages of XML parts. This script copies every part of
the original byte-for-byte and re-serializes ONLY the affected part (one
worksheet, or word/document.xml), so fidelity risk is confined to that part.
The source file is never modified. Standard library only — no dependencies.

Edit JSON shapes (pass via --edits):

    {"format": "xlsx", "sheet": "Sheet1", "cells": {"B2": 42, "C3": "hello", "D4": true}}
    {"format": "docx", "replacements": [{"paragraph": 3, "text": "new text"}]}

xlsx: each cell is overwritten with the JSON value (number, string, or
boolean); an existing formula in that cell is replaced by the value.
docx: 'paragraph' is the zero-based ordinal among BODY-LEVEL paragraphs
(tables excluded); the paragraph keeps its paragraph style and the first
run's character style, but other inline content (extra run styling,
hyperlinks) inside that one paragraph is flattened into the new text.
"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_ATTR_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"

# Prefixes Word/Excel conventionally use; registering them keeps re-serialized
# parts using the same prefixes the rest of the package refers to.
OOXML_PREFIXES = {
    "": SPREADSHEET_NS,
    "r": RELATIONSHIP_ATTR_NS,
    "w": WORD_NS,
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "v": "urn:schemas-microsoft-com:vml",
    "o": "urn:schemas-microsoft-com:office:office",
    "w10": "urn:schemas-microsoft-com:office:word",
    "x14ac": "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
}

A1_CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")


def fail(message: str) -> "sys.NoReturn":
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def column_to_index(letters: str) -> int:
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index


def parse_a1_cell(ref: str) -> tuple[int, int]:
    match = A1_CELL_RE.match(ref)
    if not match:
        fail(f"invalid A1 cell reference: {ref!r}")
    return column_to_index(match.group(1)), int(match.group(2))


def serialize_part(root: ET.Element) -> bytes:
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + ET.tostring(root, encoding="unicode").encode(
        "utf-8"
    )


# ── xlsx ─────────────────────────────────────────────────────────────────────


def resolve_worksheet_part(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationship_id = None
    for sheet in workbook.iter(f"{{{SPREADSHEET_NS}}}sheet"):
        if sheet.get("name") == sheet_name:
            relationship_id = sheet.get(f"{{{RELATIONSHIP_ATTR_NS}}}id")
            break
    if relationship_id is None:
        names = [sheet.get("name") for sheet in workbook.iter(f"{{{SPREADSHEET_NS}}}sheet")]
        fail(f"worksheet not found: {sheet_name!r} (has: {names})")

    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    for relationship in rels.iter(f"{{{PACKAGE_RELS_NS}}}Relationship"):
        if relationship.get("Id") == relationship_id:
            target = relationship.get("Target", "")
            return target.lstrip("/") if target.startswith("/") else f"xl/{target}"
    fail(f"workbook relationship {relationship_id!r} not found")
    raise AssertionError  # unreachable


def qn(namespace: str, tag: str) -> str:
    return f"{{{namespace}}}{tag}"


def set_cell_value(cell: ET.Element, value) -> None:
    for child in list(cell):
        cell.remove(child)
    cell.attrib.pop("t", None)
    if isinstance(value, bool):
        cell.set("t", "b")
        ET.SubElement(cell, qn(SPREADSHEET_NS, "v")).text = "1" if value else "0"
    elif isinstance(value, (int, float)):
        ET.SubElement(cell, qn(SPREADSHEET_NS, "v")).text = repr(value)
    elif isinstance(value, str):
        cell.set("t", "inlineStr")
        inline = ET.SubElement(cell, qn(SPREADSHEET_NS, "is"))
        text = ET.SubElement(inline, qn(SPREADSHEET_NS, "t"))
        text.set(qn(XML_NS, "space"), "preserve")
        text.text = value
    else:
        fail(f"unsupported cell value type: {type(value).__name__} (use number, string, or boolean)")


def find_or_create_ordered(parent: ET.Element, tag: str, sort_key, key, attr_ref: str) -> ET.Element:
    """Find child with attribute r == attr_ref, or insert one keeping siblings ordered."""
    for child in parent.findall(tag):
        if child.get("r") == attr_ref:
            return child
    # An r-less sibling's position is inferred from document order, so inserting a
    # referenced element beside it could address the same cell twice. Refuse rather
    # than risk a corrupt derived file.
    if any(child.get("r") is None for child in parent.findall(tag)):
        fail(f"worksheet has {tag.split('}')[-1]} elements without 'r' attributes; refusing to edit this workbook")
    created = ET.Element(tag, {"r": attr_ref})
    insert_at = len(list(parent))
    for position, child in enumerate(list(parent)):
        child_ref = child.get("r")
        if child.tag == tag and child_ref is not None and sort_key(child_ref) > key:
            insert_at = position
            break
    parent.insert(insert_at, created)
    return created


def patch_xlsx(archive: zipfile.ZipFile, edits: dict) -> dict[str, bytes]:
    sheet_name = edits.get("sheet")
    cells = edits.get("cells")
    if not sheet_name or not isinstance(cells, dict) or not cells:
        fail("xlsx edits require 'sheet' and a non-empty 'cells' object")

    part_name = resolve_worksheet_part(archive, sheet_name)
    ET.register_namespace("", SPREADSHEET_NS)
    for prefix, uri in OOXML_PREFIXES.items():
        if prefix:
            ET.register_namespace(prefix, uri)
    root = ET.fromstring(archive.read(part_name))
    sheet_data = root.find(qn(SPREADSHEET_NS, "sheetData"))
    if sheet_data is None:
        fail(f"{part_name} has no sheetData element")

    row_tag = qn(SPREADSHEET_NS, "row")
    cell_tag = qn(SPREADSHEET_NS, "c")
    for ref, value in sorted(cells.items(), key=lambda item: (parse_a1_cell(item[0])[1], parse_a1_cell(item[0])[0])):
        column, row_number = parse_a1_cell(ref)
        row = find_or_create_ordered(sheet_data, row_tag, lambda r: int(r), row_number, str(row_number))
        cell = find_or_create_ordered(row, cell_tag, lambda r: parse_a1_cell(r)[0], column, ref)
        set_cell_value(cell, value)

    return {part_name: serialize_part(root)}


# ── docx ─────────────────────────────────────────────────────────────────────


def patch_docx(archive: zipfile.ZipFile, edits: dict) -> dict[str, bytes]:
    replacements = edits.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        fail("docx edits require a non-empty 'replacements' array")

    ET.register_namespace("", WORD_NS)
    for prefix, uri in OOXML_PREFIXES.items():
        if prefix and prefix != "r":
            ET.register_namespace(prefix, uri)
    ET.register_namespace("r", RELATIONSHIP_ATTR_NS)
    root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(qn(WORD_NS, "body"))
    if body is None:
        fail("word/document.xml has no body element")
    paragraphs = [child for child in body if child.tag == qn(WORD_NS, "p")]

    for replacement in replacements:
        index = replacement.get("paragraph")
        text = replacement.get("text")
        if index is None or int(index) < 0 or not isinstance(text, str):
            fail(f"each replacement needs a non-negative 'paragraph' and string 'text': {replacement!r}")
        index = int(index)
        if index >= len(paragraphs):
            fail(f"paragraph {index} out of range (document has {len(paragraphs)} body paragraphs)")
        paragraph = paragraphs[index]

        properties = paragraph.find(qn(WORD_NS, "pPr"))
        first_run_properties = None
        first_run = paragraph.find(qn(WORD_NS, "r"))
        if first_run is not None:
            first_run_properties = first_run.find(qn(WORD_NS, "rPr"))

        for child in list(paragraph):
            if child is not properties:
                paragraph.remove(child)
        run = ET.SubElement(paragraph, qn(WORD_NS, "r"))
        if first_run_properties is not None:
            run.append(first_run_properties)
        text_element = ET.SubElement(run, qn(WORD_NS, "t"))
        text_element.set(qn(XML_NS, "space"), "preserve")
        text_element.text = text

    return {"word/document.xml": serialize_part(root)}


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
