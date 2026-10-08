"""Everything pdf: the extract path. A PDF is not an OOXML package, so this module reaches
common.py for its size ceiling and never touches ooxml.py.

pypdf is imported inside extract_pdf, never at module scope: office_extract.py imports this
module eagerly for every format, and a top-level third-party import would make a pypdf-less
environment fail on an xlsx source.
"""

from pathlib import Path

from office.common import MAX_ENTRY_BYTES, fail, require_index, slice_char_range


def extract_pdf(src: Path, anchor: dict, out_path: Path, out_format: str) -> None:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        fail("pypdf is required for pdf sources — rerun via `uv run --with pypdf python ...`")

    if anchor.get("page") is None:
        fail("pdf anchor requires a one-based 'page' number")
    page_number = require_index(anchor.get("page"), "pdf anchor 'page'", 1)
    page_index = page_number - 1

    # OOXML sources go through preflight_zip; PDFs had no ceiling at all before PdfReader parsed them.
    source_bytes = src.stat().st_size
    if source_bytes > MAX_ENTRY_BYTES:
        fail(f"pdf is {source_bytes} bytes (limit {MAX_ENTRY_BYTES}); ask for a smaller file")

    reader = PdfReader(str(src))
    if page_index >= len(reader.pages):
        fail(f"page {page_number} out of range (document has {len(reader.pages)} pages)")
    page = reader.pages[page_index]

    if out_format == "pdf":
        writer = PdfWriter()
        writer.add_page(page)
        with out_path.open("wb") as handle:
            writer.write(handle)
    elif out_format in ("txt", "md"):
        text = slice_char_range(page.extract_text() or "", anchor.get("charRange"))
        out_path.write_text(text + "\n", encoding="utf-8")
    else:
        fail(f"unsupported output format for pdf source: {out_format!r} (use pdf, txt, or md)")
