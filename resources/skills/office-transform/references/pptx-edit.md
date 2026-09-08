# Edit pptx — use python-pptx, saving to a new path

Routed here from **"Edit pptx"** in `SKILL.md`. The two skill invariants still hold: the
source deck is read-only, and the derived deck is written to a path nothing occupies yet.

pptx edits do not go through `office_patch_copy.py`. `python-pptx` keeps XML it does not
understand, so the parts you never touch round-trip intact. That guarantee covers the
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
