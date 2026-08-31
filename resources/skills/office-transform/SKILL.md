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

The `anchor` object is exactly what the scripts take via `--anchor`.

**Freshness check.** `fileStamp.mtimeMs` is milliseconds since the Unix epoch, floored to
whole milliseconds. Do not compare it to `stat`'s default output: `stat -f %m` (macOS) and
`stat -c %Y` (GNU) give whole *seconds*, so multiplying by 1000 loses the sub-second part and
never matches. Read whole milliseconds the way the app wrote them:

```bash
uv run python -c "import os,sys;st=os.stat(sys.argv[1]);print(st.st_size, st.st_mtime_ns//1_000_000)" '/abs/report.xlsx'
```

Treat the file as changed when the size differs, or when the mtimes differ by more than 2 ms.
The tolerance is small on purpose: both sides floor the same nanosecond timestamp to
milliseconds, so they agree exactly, and the couple of milliseconds only covers the rounding
of a `double` that can no longer represent current epoch milliseconds exactly. A wider window
would hide real edits — a same-size change made within it would read as unchanged, which is
why the anchor check below is not optional. On a change, tell the user the file changed since
they selected and ask them to re-select — never silently re-anchor.

**Anchor check.** Before a patch-copy edit, also verify the anchor still points where the
user thinks: extract the anchored region and compare its text with the reference's `excerpt`,
normalizing both sides the same way (NFC, collapse each whitespace run to one space, trim).
The two are not equal and are not meant to be — the `excerpt` is what the user selected, while
the extract is the whole region an edit would replace. A selection sitting inside one region
makes the `excerpt` the shorter side; a selection running past that region anchors to where it
*starts*, which makes it the longer one. So the test is containment, whichever way round fits:
the `excerpt` appears inside the extract, or the extract's tail is where the `excerpt` begins.
Only when neither holds has the anchor stopped pointing at the selection — then stop and tell
the user, never edit at a mismatched anchor and never go searching for a "close enough"
location. Two cases need care because the two sides are not directly comparable as-is:

- **xlsx**: the `excerpt` is tab-separated cells and newline-separated rows, while extraction
  writes csv or md. Compare cell values, not the raw file — read the csv with a csv reader and
  join the fields with single spaces before normalizing, so `,` and `|` never count as a
  difference. That join drops the cell boundaries on both sides, so a match proves the text is
  unchanged, not the grid — the same words re-split across cells still reads as a match. The
  freshness check above is what catches that; never skip it on a passing anchor check.
  Number formats are the second asymmetry: the `excerpt` holds what Excel *displays*, because
  that is what the user pointed at (`1,234.50`, `45.67%`), while extraction writes the stored
  value (`1234.5`, `0.4567`). Neither side is wrong, so a formatted cell never matches
  literally. Compare those cells by value, and leave them out of the joined strings so the
  containment test runs on the text cells alone. A difference that is only the number format is
  not a moved anchor, and stopping on one sends the user back to re-select a selection that
  never moved.
- **docx with `charRange`**: the slice is only part of what patch-copy compares and replaces —
  it rewrites the **whole paragraph**. Extract the paragraph *without* `charRange` as well, and
  read "Edit docx" below before writing.

Users may also describe the region in words ("sheet 2, columns A through C"); build the anchor
JSON yourself, confirming the worksheet name or paragraph if ambiguous.

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

Always single-quote paths — real documents have spaces in their names (`Q1 report.xlsx`).
If a path itself contains a single quote, close and reopen the quoting around it:
`'/abs/Bob'\''s deck.pptx'`.

```bash
uv run --with openpyxl python scripts/office_extract.py \
  --file '/abs/report.xlsx' \
  --anchor '{"format":"xlsx","sheet":"Sheet1","range":"A1:C10"}' \
  --out '/abs/report-q1-range.csv'
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
  --file '/abs/report.xlsx' \
  --edits '{"format":"xlsx","sheet":"Sheet1","cells":{"B2":42,"C3":"hello"}}' \
  --out '/abs/report-updated.xlsx'
```

OOXML packages are ZIPs of XML parts. Patch-copy copies every part byte-for-byte and
re-serializes only what an edit reaches — the target worksheet or `word/document.xml`, plus
the workbook bookkeeping noted below for xlsx — so styles, charts, images, and macros in
untouched parts survive exactly. Edit shapes:

- `{"format":"xlsx","sheet":"S","cells":{"B2":42,"C3":"text","D4":true}}` — numbers,
  strings, and booleans; an existing formula in an edited cell is replaced by the value.
  Patch-copy does not recalculate, so a formula reading an edited cell keeps the value it
  last cached; every write sets `fullCalcOnLoad` in `xl/workbook.xml` so Excel recomputes
  those on open.
  Replacing a formula also drops `xl/calcChain.xml` (a recalculation cache Excel rebuilds),
  along with the content-type and relationship entries that would otherwise point at a part
  no longer there; keeping a chain entry for a cell that no longer has a formula makes Excel
  report the derived file as damaged. Cells in a **shared, array, or data-table formula group are refused** — the
  expression lives in one member and the others only reference it, so overwriting a member
  would strip the formula from cells you never named. Rewrite such a range with `openpyxl`.
  Coordinates outside the worksheet grid (past XFD or row 1048576) are refused too.
- `{"format":"docx","replacements":[{"paragraph":3,"text":"new text"}]}` — the
  paragraph keeps its paragraph style and the first run's character style; extra run-level
  styling within that one paragraph is flattened into the new text.
  **`text` must be the complete new paragraph.** The whole body paragraph is replaced, and
  `charRange` does not narrow that — feeding back a `charRange` slice as `text` silently
  discards the rest of the sentence.
  The output is exactly `w:p > [w:pPr] + w:r > [w:rPr] + w:t`, so a paragraph holding anything
  that shape cannot carry is **refused**, not silently stripped. That covers bookmarks, comment
  anchors and fields (their start/end can pair across paragraphs, and rewriting one half
  unbalances the document), images, embedded objects, footnote/endnote references, hyperlinks,
  tracked changes and moves, content controls, equations — and anything else not on the short
  allow-list, including elements from namespaces that did not exist when this was written.
  A dropped `w:del` would even accept a pending deletion on the user's behalf.
  To edit such a paragraph, see **"Edit docx"** below — do not reach for
  `Paragraph.text`, which destroys exactly the same content, only silently.
- Any text written into a cell or paragraph must be storable in XML: control characters
  other than tab, newline and carriage return are refused. Text extracted from a deck can
  carry them (python-pptx maps a soft line break to `\x0B`), so strip them before feeding
  extracted text back in as an edit value. A **docx paragraph** refuses tab, newline and
  carriage return as well: WordprocessingML spells those `<w:tab/>` and `<w:br/>`, and the
  single `w:t` this rewrite emits cannot carry them. Extracting a paragraph that holds them
  gives you `\t` / `\n`, so editing that string and writing it back would delete the
  elements while reading identically — split the content across separate body paragraphs,
  or see **"Edit docx"** below.

### Generate — write ad-hoc library code for new documents

Generation (a fresh deck, workbook, or document — from scratch or from data you
just extracted) has no source file to protect, so there is no fixed script: write a
short Python program against the matching library (`python-pptx`, `openpyxl`,
`python-docx`) and run it via `uv run --with <pkg> python`. The two skill
invariants still apply: write to a path nothing occupies yet — open it with `"xb"`
rather than handing the library a name, since every one of these `save()` methods
overwrites — and verify the output by reopening it before reporting success.

### Edit docx — edit runs, never `Paragraph.text`

When patch-copy refuses a paragraph, the reason is that the paragraph holds structure a
single rebuilt run cannot carry. `python-docx` can preserve it, but **only if you edit runs
in place**. Assigning `paragraph.text = "..."` clears the paragraph and rebuilds one run,
destroying bookmarks, comment anchors, hyperlinks, images and run formatting — the same loss
patch-copy refused to inflict, minus the refusal.

Two traps make the naive loop wrong:

- `paragraph.runs` does **not** include runs inside a `w:hyperlink`, while `paragraph.text`
  does. Offsets computed against `.text` will not line up with `.runs`. Walk
  `iter_inner_content()` instead.
- `Run.text`'s setter keeps that run's `rPr`, but rewrites the run's content from the
  characters you give it. It can only spell back what a character stands for: a bare `w:br`
  or `w:tab` survives, while `w:br w:type="page"` and `w:noBreakHyphen` vanish and `w:ptab`
  returns as a plain `w:tab`. A touched run is checked for those before it is written.

```python
from docx.oxml.ns import qn

def inline_runs(paragraph):
    """Runs in document order, including those inside hyperlinks, so the concatenation of
    their text equals paragraph.text and character offsets line up."""
    runs = []
    for item in paragraph.iter_inner_content():   # python-docx >= 1.1
        runs.extend(item.runs) if hasattr(item, "runs") else runs.append(item)
    return runs

def rebuildable(run):
    """Whether Run.text's setter can put this run back. It rewrites the run from characters,
    so it restores only what a character spells: a bare w:br or w:tab. A page break, a column
    break, a w:ptab or a w:noBreakHyphen comes back as the plain kind or not at all, which
    changes the layout without changing the text — refuse instead."""
    for child in run._r:
        if child.tag in (qn("w:rPr"), qn("w:t")):
            continue
        if child.tag in (qn("w:br"), qn("w:tab")) and not child.attrib:
            continue
        return False
    return True

def replace_char_range(paragraph, start, end, new_text):
    """Replace paragraph.text[start:end] by editing run text only."""
    position, written = 0, False
    for run in inline_runs(paragraph):
        run_start, run_end = position, position + len(run.text)
        position = run_end
        if run_end <= start or run_start >= end:
            continue
        if not rebuildable(run):
            raise ValueError("run holds inline content the text setter cannot rebuild")
        head = run.text[: max(0, start - run_start)]
        tail = run.text[max(0, end - run_start) :] if end < run_end else ""
        run.text = head + ("" if written else new_text) + tail
        written = True
    if not written:
        raise ValueError("charRange did not intersect any run")

# `save(path)` overwrites whatever is there, and a library edit owes the caller the same
# no-overwrite guarantee the scripts give. "x" states it without a check that can race.
with open("/abs/report-updated.docx", "xb") as out:
    document.save(out)
```

Verify by reopening the derived file and checking that the structure you meant to keep is
still there — not just that the text reads correctly:

```python
from docx import Document
check = Document("/abs/report-updated.docx")
para = check.paragraphs[3]
assert para.text == expected_text
assert len(para.runs) == runs_before          # nothing collapsed
assert "bookmarkStart" in para._p.xml         # anchors intact, if the source had them
```

### Edit pptx — use python-pptx, saving to a new path

pptx edits do not go through `office_patch_copy.py`. `python-pptx` keeps XML it does not
understand, so the parts you never touch round-trip intact (unlike `openpyxl`, which drops
charts and drawings — that is why xlsx edits use patch-copy). That guarantee covers the
document around your edit; it does **not** make any given API call lossless. Assigning
`.text` at paragraph or shape level rebuilds that subtree as one unformatted run, discarding
bold, size, colour and `a:hlinkClick` and orphaning the hyperlink relationship. Edit runs:

```python
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

def walk(shapes):  # extraction recurses into groups, so editing must too — a flat
    for shape in shapes:  # `for s in slide.shapes` cannot reach a grouped shape_id
        yield shape
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from walk(shape.shapes)

from pptx.oxml.ns import qn

def replace_char_range(paragraph, start, end, new_text):
    """Replace paragraph.text[start:end] by editing run text only, so each run keeps its rPr
    (bold, size, colour) and its a:hlinkClick. Everything that contributes to paragraph.text
    without being a run has to be accounted for or every later offset shifts: a:br is one
    position, and a:fld holds generated text that must not be rewritten. Skipping a child that
    carries text moves the edit somewhere else without saying so, which is why an unrecognized
    one is refused rather than passed over."""
    position, written, covered = 0, False, []
    for child in list(paragraph._p):
        if child.tag in (qn("a:pPr"), qn("a:endParaRPr")):
            continue                                  # properties, no text of their own
        if child.tag == qn("a:br"):
            if start <= position < end:
                covered.append(child)                 # removed below, once the range is known good
            position += 1
            continue
        if child.tag == qn("a:fld"):
            field = "".join(t.text or "" for t in child.findall(qn("a:t")))
            if position < end and start < position + len(field):
                raise ValueError("charRange covers an a:fld; its text is generated, not stored")
            position += len(field)
            continue
        if child.tag != qn("a:r"):
            raise ValueError(f"paragraph holds {child.tag}, which this helper cannot position")
        run = next(r for r in paragraph.runs if r._r is child)
        run_start, run_end = position, position + len(run.text)
        position = run_end
        if run_end <= start or run_start >= end:
            continue
        head = run.text[: max(0, start - run_start)]
        tail = run.text[max(0, end - run_start) :] if end < run_end else ""
        run.text = head + ("" if written else new_text) + tail
        written = True
    if not written:                                   # nothing removed yet, so this leaves the
        raise ValueError("charRange did not intersect any run")   # paragraph as it was found
    for child in covered:
        paragraph._p.remove(child)

p = Presentation("/abs/deck.pptx")
shape = next(s for s in walk(p.slides[1].shapes) if s.shape_id == 4)
before = shape.text_frame.paragraphs[0]

replace_char_range(before, 8, 11, "8%")               # anchor had "paragraph": 0
# replace_char_range(shape.table.cell(1, 0).text_frame.paragraphs[0], ...)   # "tableCell" anchor

# `save(path)` overwrites whatever is there. The scripts refuse an existing --out; a library
# edit has to refuse one too, and "x" is how you say that without a check that can race.
with open("/abs/deck-updated.pptx", "xb") as out:
    p.save(out)
```

Verify that the formatting survived, not just the text — `paragraphs[0].text == "..."` plus a
paragraph count passes even when every run was collapsed into one unformatted run:

```python
check = Presentation("/abs/deck-updated.pptx")
edited = next(s for s in walk(check.slides[1].shapes) if s.shape_id == 4)
after = edited.text_frame.paragraphs[0]
assert after.text == expected_text
assert len(after.runs) == len(before.runs)                                  # nothing collapsed
assert [r.hyperlink.address for r in after.runs] == [r.hyperlink.address for r in before.runs]
assert [(r.font.bold, r.font.size) for r in after.runs] == [(r.font.bold, r.font.size) for r in before.runs]
```

A table shape has no `text_frame` at all — reaching for one raises `AttributeError`. Route a
`tableCell` anchor through `shape.table.cell(row, col).text_frame`.

## Output conventions

- Name derived files after the source with an operation suffix:
  `report.xlsx` → `report-updated.xlsx`, `report-q1-range.csv`, `spec-p3.txt`.
- Write into the session workspace (or where the user asked). Both scripts print the
  written path on success — report it to the user.
- `--file` and `--out` must both be absolute; a relative path is refused rather than
  resolved against whatever working directory the shell happens to be in.
- Output is staged and renamed on success, so a failed run leaves nothing behind and the
  same command can be retried at the same path.

## Verify before reporting success

Always reopen the derived file with the matching reader and check the result, e.g.:

```bash
uv run --with openpyxl python -c "
from openpyxl import load_workbook
ws = load_workbook('/abs/report-updated.xlsx', data_only=True)['Sheet1']
print(ws['B2'].value)"
```

`data_only` reads cached values and patch-copy does not recalculate, so a formula reading a
cell you just wrote still reads back its old result. Check the cells you wrote, and tell the
user the dependent totals are recomputed when Excel opens the file.

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
