"""Everything xlsx: the A1 primitives, the extract (read) path and the patch-copy (write) path.

The user-visible description of what an xlsx edit does lives in ../office_patch_copy.py's
module docstring — that text is the script's --help output, so changing behaviour here means
changing it there too.

openpyxl is imported inside extract_xlsx, never at module scope: office_extract.py imports
this module eagerly for every format, and a top-level third-party import would make an
xlsx-only environment fail on a docx source (and vice versa). The write path is standard
library only.
"""

import csv
import datetime
import math
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.dom import minidom

from office.common import fail
from office.ooxml import (
    element_children,
    first_child,
    make_tag,
    read_xml_part,
    reject_invalid_xml_text,
    reject_strict_ooxml,
    serialize_part,
)

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_ATTR_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

A1_CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")

MAX_RANGE_CELLS = 1_000_000

CONTENT_TYPES_PART = "[Content_Types].xml"
WORKBOOK_RELS_PART = "xl/_rels/workbook.xml.rels"
CALC_CHAIN_PART = "xl/calcChain.xml"
WORKBOOK_PART = "xl/workbook.xml"

# The SpreadsheetML grid (ECMA-376): columns A..XFD, rows 1..1048576. A1 notation happily spells
# coordinates past both, and writing one produces a cell Excel cannot place.
MAX_COLUMN_INDEX = 16_384
MAX_ROW_NUMBER = 1_048_576

# The read and write paths word the out-of-grid refusal differently: only the write path ends with
# this clause, because only it produces a file. Kept as a parameter rather than unified so neither
# message changes by a byte.
GRID_HINT = "; Excel cannot place it"


# ── A1 primitives (both paths) ───────────────────────────────────────────────


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


def parse_a1_cell(ref: str, *, hint: str = "") -> tuple[int, int]:
    match = A1_CELL_RE.match(ref)
    if not match:
        fail(f"invalid A1 cell reference: {ref!r}")
    column, row = column_to_index(match.group(1)), int(match.group(2))
    if column > MAX_COLUMN_INDEX or row > MAX_ROW_NUMBER:
        fail(
            f"cell {ref!r} is outside the worksheet grid "
            f"(max {index_to_column(MAX_COLUMN_INDEX)}{MAX_ROW_NUMBER}){hint}"
        )
    return column, row


def parse_a1_range(ref: str) -> tuple[int, int, int, int]:
    """Return (min_col, min_row, max_col, max_row) from 'B2' or 'A1:C10'."""
    parts = ref.split(":")
    if len(parts) > 2:
        fail(f"invalid A1 range: {ref!r}")
    start = parse_a1_cell(parts[0])
    end = parse_a1_cell(parts[-1])
    return (
        min(start[0], end[0]),
        min(start[1], end[1]),
        max(start[0], end[0]),
        max(start[1], end[1]),
    )


# ── read: extract ────────────────────────────────────────────────────────────


def cell_display(value) -> str:
    """Render a cell in a shape a spreadsheet reader recognises, not the way Python prints it.

    csv and md output is read as spreadsheet text and compared against the renderer's excerpt, so a
    `str()` form only Python uses is wrong on both counts: `True` where every spreadsheet writes
    `TRUE`, `2024-01-03 00:00:00` for a cell the user sees as `2024-01-03` (openpyxl hands back a
    datetime for date-only cells too, never a bare date), and `1 day, 2:30:00` for a duration Excel
    counts the hours through as `26:30:00`. Numbers keep their stored value (`0.4567`, not `45.67%`):
    presenting them any other way means implementing number formats, which SKILL.md documents as an
    accepted asymmetry between the extract and the excerpt.

    A midnight time is what marks a date-only cell, because the cell's number format is not carried
    through extract_xlsx and threading it there to decide this would touch every output path. The
    rule errs in both directions — a date-formatted cell that stores a time prints the time, a
    date-time cell that stores midnight prints as a date — and both are the number-format difference
    the anchor check already sets aside. A text cell that says `TRUE` renders the same as the
    boolean; so does the renderer, which is the point.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime.datetime):
        if value.time() == datetime.time(0):
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, datetime.time):
        return value.isoformat(timespec="seconds")
    if isinstance(value, datetime.timedelta):
        # Floor division on a negative total borrows an hour (-30 minutes would print -1:30:00), so
        # split the sign off first and format the magnitude.
        seconds = int(value.total_seconds())
        sign = "-" if seconds < 0 else ""
        seconds = abs(seconds)
        return f"{sign}{seconds // 3600}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"
    return str(value)


def write_markdown_table(rows: list[list[str]], out_path: Path) -> None:
    if not rows:
        fail("selection produced no rows")
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    # Backslashes go first. Escaping only the pipe turns a cell's own `\` into the escape for the
    # pipe that follows it, so `a\|b` reaches the reader as an escaped backslash and a live
    # separator — one cell silently becomes two.
    escaped = [
        [cell.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ") for cell in row] for row in normalized
    ]
    lines = ["| " + " | ".join(escaped[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in escaped[1:])
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def extract_xlsx(src: Path, anchor: dict, out_path: Path, out_format: str) -> None:
    try:
        from openpyxl import Workbook, load_workbook
    except ImportError:
        fail("openpyxl is required for xlsx sources — rerun via `uv run --with openpyxl python ...`")

    sheet_name = anchor.get("sheet")
    range_ref = anchor.get("range")
    if not sheet_name or not range_ref:
        fail("xlsx anchor requires 'sheet' and 'range'")
    # 'range' is one A1 string. The two-element form charRange uses in the same anchor would reach
    # .split() and traceback, and writing the pair here rather than the string is an easy slip.
    if not isinstance(range_ref, str):
        fail(f"xlsx anchor 'range' must be an A1 string like 'A1:C10', not {type(range_ref).__name__}: {range_ref!r}")

    min_col, min_row, max_col, max_row = parse_a1_range(range_ref)
    area = (max_row - min_row + 1) * (max_col - min_col + 1)
    if area > MAX_RANGE_CELLS:
        fail(f"range {range_ref!r} covers {area} cells (limit {MAX_RANGE_CELLS}); select a smaller region")

    workbook = load_workbook(src, data_only=True, read_only=True)
    if sheet_name not in workbook.sheetnames:
        fail(f"worksheet not found: {sheet_name!r} (has: {workbook.sheetnames})")
    worksheet = workbook[sheet_name]

    values = []
    # Derived-sheet coordinates of the cells that really hold an error value (`#N/A`). Under data_only
    # an error and the text "#N/A" read back as the same string; only the cell's data_type still says
    # which it was, and the xlsx output below needs to know.
    error_cells = set()
    rows = worksheet.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col)
    for row_offset, row in enumerate(rows):
        values.append([cell.value for cell in row])
        error_cells.update(
            (row_offset + 1, column_offset + 1)
            for column_offset, cell in enumerate(row)
            if cell.data_type == "e"
        )
    # Merge followers are not masked: a read_only worksheet has no merged_cells, so a mask keyed on it
    # never runs, and fetching the ranges means either a second, non-streaming load — giving up the
    # streaming this reader exists for — or hand-parsing <mergeCells>. Excel and openpyxl clear a
    # follower when the merge is made, so followers read back empty and match what the user sees;
    # the file that kept hidden text under a merge extracts it, which SKILL.md "## Limits" says out
    # loud. Any future mask must clamp to the rows iter_rows actually returned, not to max_row:
    # read_only stops at the last populated row, so a merge below the data would index past `values`.
    workbook.close()

    if out_format == "xlsx":
        derived = Workbook()
        derived_sheet = derived.active
        derived_sheet.title = sheet_name[:31]
        for row in values:
            derived_sheet.append(row)
        # append() re-infers each cell's type from its value: a string starting with "=" becomes a
        # formula and one of Excel's error codes (`#N/A`) becomes an error, so text the source merely
        # displayed comes back as something the spreadsheet runs or reports — and the formula has no
        # cached value, so re-extracting it reads nothing. Put such a cell back to a string, with
        # quotePrefix so Excel keeps treating it as text after someone edits it. A cell that held a
        # real error keeps it; error_cells is what tells the two apart.
        for row in derived_sheet.iter_rows():
            for cell in row:
                if cell.data_type not in ("f", "e"):
                    continue
                if cell.data_type == "e" and (cell.row, cell.column) in error_cells:
                    continue
                cell.data_type = "s"
                cell.quotePrefix = True
        derived.save(out_path)
    elif out_format == "csv":
        with out_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerows([[cell_display(value) for value in row] for row in values])
    elif out_format == "md":
        write_markdown_table([[cell_display(value) for value in row] for row in values], out_path)
    else:
        fail(f"unsupported output format for xlsx source: {out_format!r} (use xlsx, csv, or md)")


# ── write: patch-copy ─────────────────────────────────────────────────────────


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
        corners = [parse_a1_cell(part, hint=GRID_HINT) for part in ref.split(":")]
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
            corners = [parse_a1_cell(part, hint=GRID_HINT) for part in ref.split(":")]
            cols = [column for column, _ in corners]
            rows = [row_number for _, row_number in corners]
            ranges.append((kind, ref, (min(cols), min(rows), max(cols), max(rows))))
    return ranges


def set_cell_value(doc: minidom.Document, cell, value) -> None:
    # CT_Cell is `f?, v?, is?, extLst?`. The value is what the edit replaces; an extension payload is
    # untouched content like everything else in the part — kept verbatim, never descended into, the
    # way pPr is on the docx side — so it stays, and the new value goes in ahead of it to hold the
    # sequence. Clearing every child took it with the old value.
    extension = first_child(cell, "extLst")
    for child in list(cell.childNodes):
        if child is not extension:
            cell.removeChild(child)
    if cell.hasAttribute("t"):
        cell.removeAttribute("t")
    if isinstance(value, bool):
        cell.setAttribute("t", "b")
        v = doc.createElement(make_tag(cell.tagName, "v"))
        v.appendChild(doc.createTextNode("1" if value else "0"))
        cell.insertBefore(v, extension)
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
        cell.insertBefore(v, extension)
    elif isinstance(value, str):
        reject_invalid_xml_text(value, f"cell {cell.getAttribute('r') or '?'}")
        cell.setAttribute("t", "inlineStr")
        inline = doc.createElement(make_tag(cell.tagName, "is"))
        text = doc.createElement(make_tag(cell.tagName, "t"))
        text.setAttribute("xml:space", "preserve")
        text.appendChild(doc.createTextNode(value))
        inline.appendChild(text)
        cell.insertBefore(inline, extension)
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
    for ref, value in sorted(cells.items(), key=lambda item: (parse_a1_cell(item[0], hint=GRID_HINT)[1], parse_a1_cell(item[0], hint=GRID_HINT)[0])):
        column, row_number = parse_a1_cell(ref, hint=GRID_HINT)
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
        cell = find_or_create_ordered(doc, row, "c", lambda r: parse_a1_cell(r, hint=GRID_HINT)[0], column, ref)
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
