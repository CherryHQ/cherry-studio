---
name: office-transform
description: Derive new Office files from structural selections without touching the original. Use when the user points at part of a spreadsheet, Word document, PDF, or PowerPoint deck (a worksheet range, paragraph, page, slide, shape, or a pasted selection-ref block) and wants it extracted, converted, or edited — the result is always a NEW file; the source file is never modified. Covers xlsx range extraction to csv/markdown/xlsx, docx paragraph extraction and text replacement, pdf page extraction, pptx slide/shape/table-cell extraction and editing, and targeted xlsx cell edits.
version: 1.0.0
---

# Office Transform

Turn a structural selection of an Office/PDF document into a new derived file.

Two invariants hold for every operation:

1. **The source file is read-only.** Every result is a new file; both scripts refuse to
   write to the source path or overwrite an existing file. Never work around this with
   ad-hoc shell edits to the original.
2. **Anchors are structural.** Selections address the document's own coordinates —
   worksheet + A1 range, body-level paragraph ordinal, one-based page number — never
   screen or DOM positions.

## When to use which tool

- Only need to *read* a document to summarize or answer questions → use
  `mcp__cherry-tools__to_markdown` instead (see the cherry-tool-guide skill); it is
  lossy but built for reading.
- The user wants a *file* out — an extracted range, a converted fragment, an edited
  copy → this skill.

## Input: selection references

Chat surfaces may hand you a fenced `selection-ref` block:

```selection-ref
{"path": "/abs/report.xlsx", "anchor": {"format": "xlsx", "sheet": "Sheet1", "range": "A1:C10"}, "excerpt": "…", "fileStamp": {"size": 1024, "mtimeMs": 1700000000000}}
```

The `anchor` object is exactly what the scripts take via `--anchor`. Before acting on
one, compare `fileStamp` against the file's current size/mtime (`stat`); if they
differ, tell the user the file changed since they selected and ask them to re-select —
never silently re-anchor. Before a patch-copy edit, also verify the anchor still points
where the user thinks: extract the anchored region first and compare its text with the
reference's `excerpt` (ignoring whitespace differences); on a mismatch, stop and tell
the user the anchor no longer matches their selection — never edit at a mismatched
anchor and never go searching for a "close enough" location. Users may also describe
the region in words ("sheet 2, columns A through C"); build the anchor JSON yourself,
confirming the worksheet name or paragraph if ambiguous.

Anchor shapes:

| Format | Anchor |
| --- | --- |
| xlsx | `{"format":"xlsx","sheet":"Sheet1","range":"A1:C10"}` (range may be one cell) |
| docx | `{"format":"docx","paragraph":3,"charRange":[0,12]}` (`charRange` optional; ordinal counts body-level paragraphs only, tables excluded) |
| pdf | `{"format":"pdf","page":3,"charRange":[0,120]}` (`charRange` optional, applies to extracted text) |
| pptx | `{"format":"pptx","slide":2,"nodeId":"4","paragraph":0,"tableCell":{"row":1,"col":0}}` (`slide` is one-based; `nodeId` is the OOXML shape id — omit for the whole slide; `paragraph` and `tableCell` are optional, mutually exclusive, and only valid together with `nodeId`) |

## Operations

Scripts live in this skill's `scripts/` directory; resolve paths relative to this
skill folder. Python dependencies are per-format and provided at invocation time via
`uv run --with <pkg>` (the bundled-shell idiom — do not `pip install` globally).

### Extract — pull the anchored region into a new file

```bash
uv run --with openpyxl python scripts/office_extract.py \
  --file /abs/report.xlsx \
  --anchor '{"format":"xlsx","sheet":"Sheet1","range":"A1:C10"}' \
  --out /abs/report-q1-range.csv
```

The output format is inferred from `--out`'s extension:

| Source | Dependency (`--with`) | Output formats |
| --- | --- | --- |
| xlsx | `openpyxl` | `xlsx`, `csv`, `md` |
| docx | `python-docx` | `docx`, `txt`, `md` |
| pdf | `pypdf` | `pdf` (page copy), `txt`, `md` |
| pptx | `python-pptx` | `txt`, `md` (slide, shape, paragraph, or table-cell text) |

xlsx extraction reads computed values (`data_only`), so formula cells yield their last
saved result. docx extraction to `docx` carries text only, not run styling.

### Patch-copy — derive an edited copy, standard library only

```bash
uv run python scripts/office_patch_copy.py \
  --file /abs/report.xlsx \
  --edits '{"format":"xlsx","sheet":"Sheet1","cells":{"B2":42,"C3":"hello"}}' \
  --out /abs/report-updated.xlsx
```

OOXML packages are ZIPs of XML parts. Patch-copy copies every part byte-for-byte and
re-serializes only the part the edits touch (one worksheet, or `word/document.xml`), so
styles, charts, images, and macros in untouched parts survive exactly. Edit shapes:

- `{"format":"xlsx","sheet":"S","cells":{"B2":42,"C3":"text","D4":true}}` — numbers,
  strings, and booleans; an existing formula in an edited cell is replaced by the value.
  Replacing a formula also drops `xl/calcChain.xml` (a recalculation cache Excel rebuilds);
  keeping a chain entry for a cell that no longer has a formula makes Excel report the
  derived file as damaged. Cells in a **shared or array formula group are refused** — the
  expression lives in one member and the others only reference it, so overwriting a member
  would strip the formula from cells you never named. Rewrite such a range with `openpyxl`.
  Coordinates outside the worksheet grid (past XFD or row 1048576) are refused too.
- `{"format":"docx","replacements":[{"paragraph":3,"text":"new text"}]}` — the
  paragraph keeps its paragraph style and the first run's character style; extra run-level
  styling within that one paragraph is flattened into the new text. Paragraphs carrying
  content this rewrite cannot preserve — bookmarks, comment anchors, fields, hyperlinks —
  are **refused**, not silently stripped: their start/end markers can span paragraphs, so
  rewriting one half would leave the document unbalanced. Edit those with `python-docx`
  (`uv run --with python-docx python`), which preserves inline structure.

### Generate — write ad-hoc library code for new documents

Generation (a fresh deck, workbook, or document — from scratch or from data you
just extracted) has no source file to protect, so there is no fixed script: write a
short Python program against the matching library (`python-pptx`, `openpyxl`,
`python-docx`) and run it via `uv run --with <pkg> python`. The two skill
invariants still apply: write to a new file (never a path the user's original
occupies), and verify the output by reopening it before reporting success.

### Edit pptx — use python-pptx, saving to a new path

pptx edits do not go through `office_patch_copy.py`. `python-pptx` mutates the
original lxml tree in place and preserves XML it does not understand, so it is
round-trip safe (unlike `openpyxl`, which drops charts and drawings — that is why
xlsx edits use patch-copy). Open the source, apply the targeted change (locate
shapes by `shape_id` to match anchor `nodeId`), and `save()` to a NEW path:

```python
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

def walk(shapes):  # extraction recurses into groups, so editing must too — a flat
    for shape in shapes:  # `for s in slide.shapes` cannot reach a grouped shape_id
        yield shape
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from walk(shape.shapes)

p = Presentation("/abs/deck.pptx")
shape = next(s for s in walk(p.slides[1].shapes) if s.shape_id == 4)
shape.text_frame.text = "new text"
p.save("/abs/deck-updated.pptx")  # never save over the source

# Verify: reopen the derived deck and read the shape back.
check = Presentation("/abs/deck-updated.pptx")
assert next(s for s in walk(check.slides[1].shapes) if s.shape_id == 4).text_frame.text == "new text"
```

## Output conventions

- Name derived files after the source with an operation suffix:
  `report.xlsx` → `report-updated.xlsx`, `report-q1-range.csv`, `spec-p3.txt`.
- Write into the session workspace (or where the user asked). Both scripts print the
  written path on success — report it to the user.

## Verify before reporting success

Always reopen the derived file with the matching reader and check the result, e.g.:

```bash
uv run --with openpyxl python -c "
from openpyxl import load_workbook
ws = load_workbook('/abs/report-updated.xlsx', data_only=True)['Sheet1']
print(ws['B2'].value)"
```

If verification fails, say so and show the error — do not present an unverified file.

## Limits

- pptx edits go through python-pptx (see "Edit pptx"), not patch-copy; slide-copy
  into a new deck is not supported (python-pptx cannot clone slides) — say so
  when asked for it.
- Patched xlsx string cells become inline strings (valid OOXML; Excel reads them fine).
- Edited XML parts may lose insignificant serialization details (attribute quoting,
  empty-element form); namespace prefixes and untouched content are preserved.
- xlsx extraction refuses ranges over 1,000,000 cells; both scripts refuse packages
  with more than 10,000 entries, an entry over 256 MiB uncompressed, or over 1 GiB
  total uncompressed — ask the user for a smaller selection or file instead of
  retrying.
- Scanned/image-only PDFs yield no text (no OCR here).
