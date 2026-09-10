"""Everything docx: the extract (read) path and the patch-copy (write) path.

The user-visible description of what a docx edit does lives in ../office_patch_copy.py's
module docstring — that text is the script's --help output, so changing behaviour here means
changing it there too.

python-docx is imported inside extract_docx, never at module scope: office_extract.py imports
this module eagerly for every format, and a top-level third-party import would make a
docx-less environment fail on an xlsx source. The in-function `import docx` is an absolute
import and resolves to the third-party package, not to this module. The write path is
standard library only.
"""

import re
import unicodedata
import zipfile
from pathlib import Path
from xml.dom import minidom

from office.common import fail, require_index, slice_char_range
from office.ooxml import (
    element_children,
    first_child,
    local_name,
    make_tag,
    read_xml_part,
    reject_invalid_xml_text,
    reject_strict_ooxml,
    resolve_namespace,
    serialize_part,
)


# ── read: extract ────────────────────────────────────────────────────────────


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


# ── write: patch-copy ─────────────────────────────────────────────────────────


# The whitespace class shared with the renderer's normalizeSelectionText, written out rather than
# left to `\s`. The two runtimes disagree on `\s` — Python counts U+0085 and U+001C-U+001F, JavaScript
# counts U+FEFF, and neither is a superset of the other — so "both sides call \s" is two different
# rules, not one shared one. Spelling the set out is what makes it a contract.
SELECTION_WHITESPACE = re.compile(
    "[\t\n\x0b\x0c\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\x1c-\x1f]+"
)


def normalize_text(text: str) -> str:
    """Mirror of the renderer's normalizeSelectionText: NFC, collapse whitespace, trim."""
    return SELECTION_WHITESPACE.sub(" ", unicodedata.normalize("NFC", text)).strip(
        "\t\n\x0b\x0c\r \x85\xa0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff\x1c\x1d\x1e\x1f"
        "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    )


# The minidom twin of the `p_para_id` nested in extract_docx above. Same rule, two object
# models (python-docx `attrib` vs minidom `attributes`), so they stay two functions.
def paragraph_para_id(paragraph) -> str:
    attrs = paragraph.attributes
    if attrs is not None:
        for i in range(attrs.length):
            attr = attrs.item(i)
            if attr.name.rsplit(":", 1)[-1] == "paraId":
                return attr.value
    return None


def paragraph_text(paragraph) -> str:
    """Reproduce python-docx's Paragraph.text, which office_extract.py compares against.

    python-docx walks the paragraph's inner content — its direct w:r children plus the runs
    inside a w:hyperlink — and inside a run takes exactly `w:br | w:cr | w:noBreakHyphen |
    w:ptab | w:t | w:tab`. Everything else is absent from `.text`: deleted runs (w:delText)
    and, because text boxes live under mc:AlternateContent rather than being run children,
    text box content. Walking every descendant w:t instead would drop the separators and
    pick up text box text, failing the expectText gate on an unchanged paragraph in either
    direction.

    The mapping has to be exact, not close. expectText is compared against what
    office_extract.py read with python-docx, so any element this spells differently rejects
    an edit to a paragraph nobody touched — and says the anchor moved, which sends the caller
    back to re-extract the same string. A break is a newline only when it wraps a line: a page
    or column break contributes nothing. Each of the six is checked against python-docx 1.2.
    """
    parts = []

    def break_type(element) -> str:
        """`w:type` by local name — the prefix is the document's to choose, like everywhere else here."""
        attributes = element.attributes
        for index in range(attributes.length):
            attribute = attributes.item(index)
            if attribute.name.rsplit(":", 1)[-1] == "type":
                return attribute.value
        return ""

    def append_run(run) -> None:
        for child in element_children(run):
            local_name = child.tagName.rsplit(":", 1)[-1]
            if local_name == "t":
                parts.append("".join(t.data for t in child.childNodes if t.nodeType == minidom.Node.TEXT_NODE))
            elif local_name in ("tab", "ptab"):
                parts.append("\t")
            elif local_name == "cr":
                parts.append("\n")
            elif local_name == "br":
                # A line break is a newline; a page or column break is a layout instruction
                # `.text` does not spell.
                if break_type(child) in ("", "textWrapping"):
                    parts.append("\n")
            elif local_name == "noBreakHyphen":
                parts.append("-")

    for child in element_children(paragraph):
        local_name = child.tagName.rsplit(":", 1)[-1]
        if local_name == "r":
            append_run(child)
        elif local_name == "hyperlink":
            for run in element_children(child, "r"):
                append_run(run)

    return "".join(parts)


# Inline markers whose meaning lives outside the paragraph: bookmarks, comment anchors and fields all
# pair a start with an end that may sit in a different paragraph. Flattening the paragraph deletes one
# half and leaves the document with an unmatched marker, so these are refused rather than dropped.
WORDPROCESSING_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# What the rewrite emits, in full:  w:p > [w:pPr] + w:r > [w:rPr] + w:t
#
# So the only children that survive it are the ones that shape can carry. This is an ALLOW-list, not
# a list of dangerous elements, because the dangerous set cannot be enumerated: ECMA-376 Part 3
# (Markup Compatibility) exists precisely so consumers meet elements they do not know, w:extLst is an
# open extension channel by design, and Microsoft keeps adding namespaces (w14, w15, w16*, ink, 3D,
# SVG). Three review rounds of "enumerate what is dangerous" each missed a new batch. Inverting the
# default means an element nobody has heard of yet lands on the refusing side, and the only thing we
# must get right is whether these thirteen are truly lossless — a closed, checkable question.
PARAGRAPH_ALLOWED = {
    (WORDPROCESSING_NS, "pPr"),  # kept verbatim, never descended into
    (WORDPROCESSING_NS, "r"),  # the run being replaced
    (WORDPROCESSING_NS, "proofErr"),  # spell/grammar marker, no semantics, Word regenerates it
}

# Inside the run: the text and its typographic separators. tab, br, cr and ptab are the old text and
# losing them is the edit's intent — reject_break_characters is what makes that true rather than
# merely hoped for, since an extract shows them as \t or \n and writing one back is refused outright.
# lastRenderedPageBreak needs no such argument: Word discards and recomputes it on open.
#
# softHyphen and noBreakHyphen are the honest exceptions. Neither reaches the caller intact — a soft
# hyphen leaves no mark in the extracted text at all, and a no-break hyphen reads as a plain "-" that
# writing back downgrades it to — so their loss is not chosen, it is accepted. What is lost is where
# a line may break, never a character. Refusing them instead would strand the paragraph: the run-level
# recipe cannot rebuild them either, so both routes this skill offers would be closed.
#
# w:sym is where that trade stops. Its glyph lives in w:font/w:char and vanishes from the extract the
# same way, but what goes missing is a character the reader can see, not a hyphenation hint.
RUN_ALLOWED = {
    (WORDPROCESSING_NS, name)
    for name in ("rPr", "t", "tab", "br", "cr", "ptab", "softHyphen", "noBreakHyphen", "lastRenderedPageBreak")
}

# Friendlier names for what we expect to meet; anything absent is reported by its qualified name.
CONTENT_DESCRIPTIONS = {
    (WORDPROCESSING_NS, "bookmarkStart"): "a bookmark",
    (WORDPROCESSING_NS, "bookmarkEnd"): "a bookmark",
    (WORDPROCESSING_NS, "commentRangeStart"): "a comment anchor",
    (WORDPROCESSING_NS, "commentRangeEnd"): "a comment anchor",
    (WORDPROCESSING_NS, "commentReference"): "a comment",
    (WORDPROCESSING_NS, "permStart"): "an editing-permission range",
    (WORDPROCESSING_NS, "permEnd"): "an editing-permission range",
    (WORDPROCESSING_NS, "fldSimple"): "a field",
    (WORDPROCESSING_NS, "fldChar"): "a field",
    (WORDPROCESSING_NS, "instrText"): "a field",
    (WORDPROCESSING_NS, "hyperlink"): "a hyperlink",
    (WORDPROCESSING_NS, "drawing"): "an image",
    (WORDPROCESSING_NS, "pict"): "an image",
    (WORDPROCESSING_NS, "object"): "an embedded object",
    (WORDPROCESSING_NS, "footnoteReference"): "a footnote reference",
    (WORDPROCESSING_NS, "endnoteReference"): "an endnote reference",
    (WORDPROCESSING_NS, "ins"): "a tracked insertion",
    (WORDPROCESSING_NS, "del"): "a tracked deletion",
    (WORDPROCESSING_NS, "moveFrom"): "a tracked move",
    (WORDPROCESSING_NS, "moveTo"): "a tracked move",
    (WORDPROCESSING_NS, "sdt"): "a content control",
    (WORDPROCESSING_NS, "smartTag"): "a smart tag",
    (WORDPROCESSING_NS, "subDoc"): "a subdocument reference",
    (WORDPROCESSING_NS, "sym"): "a symbol character",
    ("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMath"): "an equation",
    ("http://schemas.openxmlformats.org/officeDocument/2006/math", "oMathPara"): "an equation",
}


def describe_element(key: tuple[str, str], element) -> str:
    if key in CONTENT_DESCRIPTIONS:
        return CONTENT_DESCRIPTIONS[key]
    return f"<{element.tagName}>"


def reject_unrepresentable_content(paragraph, index: int) -> None:
    """Refuse a paragraph holding anything the rewrite's output shape cannot carry.

    `pPr` is deliberately not descended into: it survives the rewrite untouched, so its contents are
    never at risk — descending was what made revision marks on the paragraph mark itself (pPr/rPr/w:ins)
    a false refusal.
    """
    for child in element_children(paragraph):
        key = (resolve_namespace(child), local_name(child))
        if key not in PARAGRAPH_ALLOWED:
            fail(
                f"paragraph {index} contains {describe_element(key, child)}, which this rewrite cannot "
                f"keep: it emits one plain run, so everything else in the paragraph would be deleted — "
                f"and a start marker whose matching end lives in another paragraph would leave the "
                f"document unbalanced. See \"Edit docx\" in SKILL.md for a run-level edit that "
                f"preserves inline structure, or target a paragraph without it."
            )
        if key != (WORDPROCESSING_NS, "r"):
            continue
        for grandchild in element_children(child):
            grandkey = (resolve_namespace(grandchild), local_name(grandchild))
            if grandkey not in RUN_ALLOWED:
                fail(
                    f"paragraph {index} has a run containing {describe_element(grandkey, grandchild)}, "
                    f"which this rewrite cannot keep: the replacement run carries text and character "
                    f"formatting only. See \"Edit docx\" in SKILL.md for a run-level edit that "
                    f"preserves inline structure."
                )


def reject_break_characters(text: str, index: int) -> None:
    """Refuse tab, newline and CR in docx replacement text, which one `<w:t>` cannot represent.

    WordprocessingML spells a tab `<w:tab/>` and a line break `<w:br/>` — separate elements, not
    characters. Translating rather than refusing would be a guess, because the mapping is not
    reversible: `w:br`, `w:cr` and a page break all read back as the same newline. This is reachable
    from the skill's own round trip, where it is also silent — extracting a paragraph that holds a
    real `w:tab` or `w:br` yields those characters, and writing the edited string back drops the
    elements while the text still reads the same.

    Only docx goes through here. `reject_invalid_xml_text` stays as it is: an xlsx inline string is
    where a newline legitimately means a line break inside the cell.
    """
    for name, char in (("a tab", "\t"), ("a line break", "\n"), ("a carriage return", "\r")):
        if char in text:
            fail(
                f"replacement text for paragraph {index} contains {name}, which this rewrite cannot "
                f'represent: it emits one <w:t>, while WordprocessingML spells these as <w:tab/> and '
                f'<w:br/> elements. Split the content across separate body paragraphs, or see '
                f'"Edit docx" in SKILL.md for a run-level edit.'
            )


def patch_docx(archive: zipfile.ZipFile, edits: dict) -> tuple[dict[str, bytes], set[str]]:
    replacements = edits.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        fail("docx edits require a non-empty 'replacements' array")

    doc = minidom.parseString(read_xml_part(archive, "word/document.xml"))
    reject_strict_ooxml(resolve_namespace(doc.documentElement), "word/document.xml")
    body = first_child(doc.documentElement, "body")
    if body is None:
        fail("word/document.xml has no body element")
    paragraphs = list(element_children(body, "p"))

    for replacement in replacements:
        if not isinstance(replacement, dict):
            fail(f"each replacement must be an object with 'paragraph' and 'text': {replacement!r}")
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

        para_id = replacement.get("paraId")
        if para_id:
            matches = [p for p in paragraphs if paragraph_para_id(p) == para_id]
            if len(matches) > 1:
                fail(f"paraId {para_id!r} matches {len(matches)} paragraphs; refusing an ambiguous edit")
            # No match means the paragraph was deleted or its id changed. Falling back to the
            # ordinal here would edit whatever text now sits at that position — the silent
            # wrong pick this gate exists to prevent.
            if not matches:
                fail(
                    f"paraId {para_id!r} matches no body paragraph — the document changed since the "
                    "anchor was captured; re-select instead of falling back to the ordinal"
                )
            if matches[0] is not paragraph:
                fail(
                    f"paraId {para_id!r} and paragraph {index} point at different paragraphs — "
                    "the document changed since the anchor was captured; re-select instead of guessing"
                )
            paragraph = matches[0]

        expect_text = replacement.get("expectText")
        if expect_text is not None:
            current = normalize_text(paragraph_text(paragraph))
            if normalize_text(expect_text) != current:
                fail(
                    f"expectText mismatch for paragraph {index}: the paragraph now reads {current[:120]!r} — "
                    "the anchor no longer matches; re-extract and re-select instead of editing blind"
                )

        reject_invalid_xml_text(text, f"replacement text for paragraph {index}")
        reject_break_characters(text, index)
        reject_unrepresentable_content(paragraph, index)

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
