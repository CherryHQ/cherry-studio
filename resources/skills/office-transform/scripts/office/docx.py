"""Everything docx: the extract path.

The user-visible description of what a docx edit does lives in ../office_patch_copy.py's
module docstring — that text is the script's --help output, so changing behaviour here means
changing it there too.

python-docx is imported inside extract_docx, never at module scope: office_extract.py imports
this module eagerly for every format, and a top-level third-party import would make a
docx-less environment fail on an xlsx source. The in-function `import docx` is an absolute
import and resolves to the third-party package, not to this module.
"""

from pathlib import Path

from office.common import fail, require_index, slice_char_range


def extract_docx(src: Path, anchor: dict, out_path: Path, out_format: str) -> None:
    try:
        import docx
    except ImportError:
        fail("python-docx is required for docx sources — rerun via `uv run --with 'python-docx>=1.1,<2' python ...`")

    if anchor.get("paragraph") is None:
        fail("docx anchor requires a non-negative 'paragraph' ordinal")
    paragraph_index = require_index(anchor.get("paragraph"), "docx anchor 'paragraph'", 0)

    document = docx.Document(str(src))
    paragraphs = document.paragraphs
    if paragraph_index >= len(paragraphs):
        fail(f"paragraph {paragraph_index} out of range (document has {len(paragraphs)} body paragraphs)")

    para_id = anchor.get("paraId")
    if para_id:
        def p_para_id(paragraph):
            for key, value in paragraph._p.attrib.items():
                if key.rsplit("}", 1)[-1] == "paraId":
                    return value
            return None

        matches = [i for i, p in enumerate(paragraphs) if p_para_id(p) == para_id]
        if len(matches) > 1:
            fail(f"paraId {para_id!r} matches {len(matches)} paragraphs; refusing an ambiguous anchor")
        # No match means the paragraph was deleted or its id changed. Falling back to the
        # ordinal here would extract whatever text now sits at that position.
        if not matches:
            fail(
                f"paraId {para_id!r} matches no body paragraph — the document changed since the "
                "anchor was captured; re-select instead of falling back to the ordinal"
            )
        if matches[0] != paragraph_index:
            fail(
                f"paraId {para_id!r} resolves to paragraph {matches[0]} but the anchor says {paragraph_index} — "
                "the document changed since the anchor was captured; re-select"
            )
    text = slice_char_range(paragraphs[paragraph_index].text, anchor.get("charRange"))

    if out_format in ("txt", "md"):
        out_path.write_text(text + "\n", encoding="utf-8")
    elif out_format == "docx":
        derived = docx.Document()
        derived.add_paragraph(text)
        derived.save(str(out_path))
    else:
        fail(f"unsupported output format for docx source: {out_format!r} (use txt, md, or docx)")
