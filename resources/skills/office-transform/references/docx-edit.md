# Edit docx — edit runs, never `Paragraph.text`

Routed here from **"Edit docx"** in `SKILL.md`, which patch-copy's refusal messages point at.
The two skill invariants still hold: the source file is read-only, and the derived file is
written to a path nothing occupies yet.

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
