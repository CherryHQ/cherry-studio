"""Process, I/O and CLI hygiene shared by both entry scripts.

Zero format knowledge and zero XML: everything here is true for xlsx, docx, pptx and pdf
alike. A helper that needs to know what a worksheet or a paragraph is belongs in the format
module; a helper that needs minidom belongs in ooxml.py.
"""

import contextlib
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

MAX_ZIP_ENTRIES = 10_000
MAX_ENTRY_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


def fail(message: str) -> "sys.NoReturn":
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


@contextlib.contextmanager
def atomic_output(out_path: Path):
    """Yield a staging path in the destination directory, renamed onto `out_path` only on success.

    Nothing partial ever appears at the destination: a failure removes the staging file, so the same
    command can be retried without tripping the "output path already exists" check. Without this, an
    interrupted write leaves a partial file that both looks like a result and blocks the retry.

    `Path.replace` overwrites unconditionally, so the caller's earlier `out_path.exists()` check only
    narrows the window between deciding the path is free and taking it — it does not close it, and a
    patch-copy of a large workbook holds that window open for the whole rewrite. Claiming the path
    with `O_CREAT | O_EXCL` up front closes it. Only that claim sits outside the `try`, because
    `fail` raises `SystemExit` and cleaning up from inside it would delete the file whoever won the
    race had just published. Everything after the claim is inside, so a staging file that cannot
    even be created still takes the empty claim back down with it.

    This is the only copy. office_extract.py and office_patch_copy.py each used to carry the protocol
    verbatim, deliberately, so that either script stood alone and neither imported the other — at the
    cost of a standing "change one and change both" obligation. Sibling imports ended that: an entry
    script already cannot be copied out of this directory and run, so the second copy bought nothing
    and the two are now one.
    """
    try:
        os.close(os.open(out_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
    except FileExistsError:
        fail(f"output path already exists: {out_path} — pick a fresh name instead of overwriting")
    staging = None
    try:
        handle, staging_name = tempfile.mkstemp(dir=out_path.parent, prefix=f".{out_path.name}.", suffix=".part")
        os.close(handle)
        staging = Path(staging_name)
        yield staging
        staging.replace(out_path)
    except BaseException:
        if staging is not None:
            staging.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)
        raise


def validate_io_paths(src: Path, out_path: Path) -> None:
    """Refuse the four --file/--out combinations no run should get past argument parsing.

    Both paths must be absolute; the source must exist and be a file; the output must not resolve
    to the source (the source is never modified); and the output must not already exist.
    """
    # Both paths are documented, and schema-validated upstream, as absolute. Accepting a relative one
    # silently resolves it against whatever working directory the agent happens to be in.
    for label, candidate in (("--file", src), ("--out", out_path)):
        if not candidate.is_absolute():
            fail(f"{label} must be an absolute path: {str(candidate)!r}")
    if not src.is_file():
        fail(f"source file not found: {src}")
    if out_path.resolve() == src.resolve():
        fail("output path must differ from the source file — the source is never modified")
    if out_path.exists():
        fail(f"output path already exists: {out_path} — pick a fresh name instead of overwriting")


def parse_json_object(raw: str, noun: str) -> dict:
    """Parse a CLI JSON argument, refusing anything that is not an object.

    `noun` names the argument in both messages — "anchor" for office_extract.py, "edits" for
    office_patch_copy.py.
    """
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"{noun} is not valid JSON: {error}")
    # `null` and `[]` parse fine and then fail on .get() with a traceback, which reads to the caller
    # as a broken script rather than a bad argument. An unhashable "format" — a list or a dict —
    # does the same on the caller's format lookup, so it takes the same route to the same message.
    if not isinstance(value, dict):
        fail(f"{noun} must be a JSON object, not {type(value).__name__}: {value!r}")
    return value


def _preflight_infos(infos) -> None:
    if len(infos) > MAX_ZIP_ENTRIES:
        fail(f"package has {len(infos)} entries (limit {MAX_ZIP_ENTRIES})")
    total = 0
    for info in infos:
        if info.file_size > MAX_ENTRY_BYTES:
            fail(f"package entry {info.filename!r} decompresses to {info.file_size} bytes (limit {MAX_ENTRY_BYTES})")
        total += info.file_size
    if total > MAX_TOTAL_BYTES:
        fail(f"package decompresses to {total} bytes in total (limit {MAX_TOTAL_BYTES})")


def preflight_zip(archive: zipfile.ZipFile) -> None:
    """Refuse pathological packages before decompressing anything into memory."""
    _preflight_infos(archive.infolist())


def preflight_zip_path(path: Path) -> None:
    """Refuse pathological OOXML packages before a reader decompresses them.

    Opening the package is this variant's job, so an unreadable one is diagnosed here. The
    ZipFile-taking variant above is handed an archive its caller already opened and therefore has no
    such branch — a difference in behaviour that predates this module and is left as it was.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
    except zipfile.BadZipFile:
        fail(f"not a valid OOXML package: {path}")
    _preflight_infos(infos)


def require_index(value, field: str, minimum: int) -> int:
    """Return an anchor ordinal, refusing anything int() would silently reinterpret.

    Bare int() accepts "3", 3.7 (truncated) and True (1), each of which addresses a different
    paragraph/page/slide than the caller meant and reports nothing. bool is checked first because it
    is a subclass of int.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        fail(f"{field} must be an integer, not {type(value).__name__}: {value!r}")
    if value < minimum:
        fail(f"{field} must be >= {minimum}: {value!r}")
    return value


def slice_char_range(text: str, char_range) -> str:
    if char_range is None:
        return text
    # int() would happily take "26" (as two characters) or 1.9 (truncated), each of which slices a
    # different span than the caller asked for and reports nothing.
    if not isinstance(char_range, (list, tuple)) or len(char_range) != 2:
        fail(f"charRange must be a two-element [start, end] array: {char_range!r}")
    if not all(isinstance(bound, int) and not isinstance(bound, bool) for bound in char_range):
        fail(f"charRange bounds must be integers: {char_range!r}")
    start, end = char_range
    if start > end or start < 0:
        fail(f"invalid charRange: {char_range!r}")
    # Python slicing clamps silently; every other ordinal in this file fails loudly when out of range,
    # and a charRange past the end of the text means the anchor no longer describes this paragraph.
    if start > len(text) or end > len(text):
        fail(
            f"charRange {char_range!r} runs past the end of the anchored text ({len(text)} characters); "
            f"the document changed since the anchor was captured — re-select instead of truncating"
        )
    return text[start:end]
