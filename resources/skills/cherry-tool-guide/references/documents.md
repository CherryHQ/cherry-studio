# Local document conversion

Covers `mcp__cherry-tools__to_markdown` — converting a supported readable local document
into Markdown.
This is distinct from knowledge-base tools, which search documents already indexed by
Cherry, and from shell runtimes or managed CLIs.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, supported formats, and recovery.

## Workflow

Use `mcp__cherry-tools__to_markdown` when an agent needs the structured contents of a
local document that ordinary text reads cannot handle.

Pass a path relative to the session workspace or an absolute path to any readable local
file. Cherry converts the source with its bundled document converter and writes the complete result
to an agent-private temporary Markdown file. The tool result contains only that file's
absolute path and character count — it deliberately does not inject the whole document
into context. Read the returned file in slices, search it, or copy it to a user-requested
final path with the ordinary file tools.

## Supported inputs

| Family | Extensions |
| --- | --- |
| Word | `.doc`, `.docx`, `.docm` |
| PowerPoint | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm` |
| Excel | `.xls`, `.xlsx`, `.xlsm`, `.xlsb` |
| OpenDocument | `.odt`, `.ods`, `.odp` |
| Other | `.rtf`, `.epub`, `.csv`, `.pdf` |

The tool currently accepts one required argument: `path`, a workspace-relative path or
an absolute local path. It does not accept an output path, format
override, page range, password, or OCR option. The converter detects recognizable
formats from file contents and falls back to the extension; CSV has no signature, so it
must use the `.csv` extension.

The source must be a readable regular file and must not exceed the tool's size limit.
Path authorization follows the runtime's global tool policy; the converter does not add
a workspace or Agent-session boundary. Temporary conversions older than 24 hours are
removed when the tool runs again.

## Recovery and limits

- **Tool unavailable** → document conversion is unavailable in this session; do not
  install or invoke a substitute converter behind the user's back.
- **Unsupported or unreadable file** → report the converter error. Do not retry through
  `npm`, `bun x`, `npx`, direct `mise`, a remote installer, or a manually downloaded
  binary.
- **Empty output** → report that no text was produced; never present it as a successful
  conversion.
- **Scanned/image-only PDF** → OCR is required and this tool does not provide it.
- **Windows ARM64** → upstream currently publishes no native binding, so conversion is
  unavailable on that platform.

## Example

> "Summarize `reports/q3-review.pptx`."

Call `mcp__cherry-tools__to_markdown` with `reports/q3-review.pptx` → read or search the
returned temporary Markdown path in slices → summarize the relevant sections. Do not
install a separate document CLI or load the complete Markdown into model context.
