"""OOXML package and minidom plumbing shared by the xlsx and docx edit paths.

Everything here knows about XML parts, namespaces and minidom nodes, and nothing here knows
what a worksheet cell or a Word paragraph is. Only office_patch_copy.py's formats reach this
module today; the extract path stops at common.py.
"""

import codecs
import zipfile
from xml.dom import minidom

from office.common import fail

# ISO 29500 Strict binds the same elements to a second namespace family. Every lookup in the format
# modules matches the Transitional URIs literally, so a Strict package is out of scope — see
# reject_strict_ooxml.
STRICT_NS_PREFIX = "http://purl.oclc.org/ooxml/"


def reject_strict_ooxml(namespace: str, part: str) -> None:
    """Refuse an ISO 29500 Strict package by name rather than by its symptom.

    Matching both families would assert the two are interchangeable, which they are not — attribute
    value spaces and date representations differ — and it would buy nothing, since openpyxl and
    python-docx, the readers this skill pairs with, cannot open Strict either. Only the diagnosis is
    worth fixing. Without this a Strict workbook reports having no worksheets at all, and a Strict
    paragraph is refused for "containing <w:r>": both send the caller searching the wrong file for
    the wrong problem.
    """
    if namespace.startswith(STRICT_NS_PREFIX):
        fail(
            f"{part} uses the ISO 29500 Strict namespace ({namespace}); this script reads Transitional "
            f"OOXML only, which is what Excel and Word write by default. Re-save the file in the "
            f'default format (not "Strict Open XML"), then retry.'
        )


def reject_invalid_xml_text(value: str, where: str) -> None:
    """Refuse text XML 1.0 cannot represent, before it reaches a text node.

    minidom escapes `& < > " '` but happily serializes C0 control characters, which XML 1.0 forbids in
    character data (only tab, LF and CR are legal). Writing one produces a part no parser will read
    back — Excel and Word open the derived file in repair mode. This is reachable from the skill's own
    output: python-pptx maps a soft line break to \x0B, so text extracted from a deck and fed back in
    as a cell value or paragraph carries it.
    """
    for index, char in enumerate(value):
        code = ord(char)
        legal = code in (0x9, 0xA, 0xD) or 0x20 <= code <= 0xD7FF or 0xE000 <= code <= 0xFFFD or code >= 0x10000
        if not legal:
            fail(
                f"{where} contains a character XML cannot store (U+{code:04X} at offset {index}); "
                f"strip control characters — a derived file holding one will not open"
            )


def contains_doctype(data: bytes) -> bool:
    """Look for a DTD across the encodings an XML part may legally use.

    A raw `b"<!DOCTYPE" in data` only matches UTF-8/ASCII. XML also permits UTF-16 and UTF-32, where the
    same text is interleaved with null bytes — so a UTF-16 part carrying a DTD walked straight past the
    check and reached the parser with its entities intact. Decode by BOM (falling back to UTF-8) and look
    at text instead of bytes.
    """
    for bom, encoding in (
        (codecs.BOM_UTF32_LE, "utf-32-le"),
        (codecs.BOM_UTF32_BE, "utf-32-be"),
        (codecs.BOM_UTF16_LE, "utf-16-le"),
        (codecs.BOM_UTF16_BE, "utf-16-be"),
        (codecs.BOM_UTF8, "utf-8-sig"),
    ):
        if data.startswith(bom):
            return "<!DOCTYPE" in data.decode(encoding, errors="ignore")
    # No BOM: XML without one must be UTF-8, but a null-interleaved body still means UTF-16/32 was used,
    # so decoding under both keeps the check honest rather than trusting the declaration.
    if b"\x00" in data[:4]:
        return any("<!DOCTYPE" in data.decode(enc, errors="ignore") for enc in ("utf-16-le", "utf-16-be"))
    return "<!DOCTYPE" in data.decode("utf-8", errors="ignore")


def read_xml_part(archive: zipfile.ZipFile, name: str) -> bytes:
    try:
        data = archive.read(name)
    except KeyError:
        fail(f"package has no part named {name!r}")
    # OOXML parts never carry a DTD; one here can only mean entity-expansion mischief.
    if contains_doctype(data):
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


def serialize_part(doc: minidom.Document) -> bytes:
    """Serialize a part, refusing to emit anything that cannot be parsed back.

    The reparse is a structural backstop, not a formality. Character-level gates catch the cases we
    thought of one at a time — a C0 control character slipped through exactly that way. Handing the
    output back to the same parser catches the whole class mechanically: if expat cannot read it,
    neither can Excel or Word, and a derived file that opens in repair mode is the failure this
    script exists to prevent.
    """
    part = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + doc.documentElement.toxml().encode("utf-8")
    try:
        minidom.parseString(part)
    except Exception as error:  # noqa: BLE001 - any parse failure means the part is unusable
        fail(f"refusing to write a part that cannot be parsed back ({error}); this is a bug in the edit path")
    return part


def local_name(element) -> str:
    return element.tagName.rsplit(":", 1)[-1]


def resolve_namespace(element) -> str:
    """Namespace URI for an element, resolved through the xmlns declarations in scope.

    `minidom.parseString` is not namespace-aware, so `element.namespaceURI` is always None and only
    the literal prefix survives. Matching on the prefix would be wrong in both directions: a document
    may bind `w:` to something else, and it may bind WordprocessingML to a different prefix. It also
    conflates namespaces that share a local name — `m:t` (equation text) would pass a bare "t" check.
    """
    prefix = element.tagName.rsplit(":", 1)[0] if ":" in element.tagName else ""
    declaration = f"xmlns:{prefix}" if prefix else "xmlns"
    node = element
    while node is not None and node.nodeType == minidom.Node.ELEMENT_NODE:
        if node.hasAttribute(declaration):
            return node.getAttribute(declaration)
        node = node.parentNode
    return ""
