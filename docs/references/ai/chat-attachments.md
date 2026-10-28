---
description: Per-attachment routing to native file parts or capped extracted text, with read_file paging for truncated overflow
sources:
  - src/main/ai/messages/attachmentRouting.ts
  - src/main/ai/messages/fileProcessor.ts
  - src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts
  - src/shared/utils/file/fileExtensions.ts
  - src/renderer/utils/file.ts
---

# Chat Attachments

How a user's attached files reach the model on a chat turn.

**One rule, per attachment:** if the provider+model can take it as a native
input, send the **native file**; otherwise send its **extracted text**, inlined
and capped. The `read_file` tool only exists to page the overflow of large
text — it is never the *only* way the model sees content.

This is deliberate: visibility must not depend on the model choosing to call a
tool. A weak (or non-tool-calling) model still sees every attachment, and a
provider that handles a modality natively keeps doing so — no capability
regression.

## Routing matrix

Decided per file part in `prepareChatMessages`
(`src/main/ai/messages/attachmentRouting.ts`):

| Attachment | Native when | What the model receives |
|---|---|---|
| HEIF/HEIC | model is vision | transient PNG image part (inline) |
| HEIF/HEIC | non-vision | localized HEIF-specific rejection; no OCR or provider request |
| other image | model is vision | native image part (inline) |
| other image | non-vision, OCR finds text | OCR text, inline (capped) |
| other image | non-vision, no OCR text (or OCR unconfigured/failed) | user-facing error; no provider request |
| pdf | provider+model native PDF | native PDF part (inline) |
| pdf | otherwise | extracted text, inline (capped) |
| office (`docx/xlsx/pptx/odf`) | — | extracted text, inline (capped) |
| text / code | — | decoded text, inline (capped) |
| no extension, or an unrecognized extension | — | decoded text when the bytes are text; otherwise unsupported note |
| audio | model and resolved endpoint are audio-capable | native audio part (inline) |
| audio | otherwise | short note ("can't process audio") |
| video | model and resolved endpoint are video-capable | native video part (inline) |
| video | otherwise | short note ("can't process video") |
| unknown extension with binary content (zip/exe/…) | — | short note ("unsupported file type") |

- **Native** → the file part is left in place and materialized as a `data:` URL
  by `materializeNativeFilePart` (`src/main/ai/messages/fileProcessor.ts`), which
  also normalizes the `mediaType` to the on-disk MIME. The provider gets the real
  file as a user-message part. (The function is named for the boundary: provider
  File-API upload for large files would slot in behind the same signature.)
- Unknown extensions undergo a conservative content sniff (binary detection +
  encoding confidence). Binary bytes or ambiguous legacy encodings get a short
  unsupported note instead of being decoded into mojibake.
- A non-vision image only degrades to OCR text when OCR actually finds text.
  Otherwise (empty OCR result, unconfigured or failed OCR) attachment routing
  raises a localized error before opening the provider request. A gateway-backed
  model that accepts images must have **Vision** enabled under Provider Settings
  → model input modalities; that user override takes precedence over the catalog
  and sends the native image without running OCR.
- HEIF conversion failures raise a localized, actionable error and stop dispatch.
  This includes historical attachments in active context: remove or exclude the
  failing attachment before a later turn can proceed. Originals remain intact.
- Any other per-file failure (missing entry, parse error, failed materialization)
  degrades to a `[could not read this file].` note rather than dropping the
  file or failing the request.
- **Non-native** → the file part is replaced by its extracted text (see the
  cap below). The internal `fileEntryId` is never written into the prompt.

Only `fileEntryId`-backed (first-party chat) images enter the OCR path. Gateway /
external file parts (no `fileEntryId`) are still eagerly materialized, but
image/audio/video parts are omitted when native support is false. Other
gateway/external file types keep their existing behavior.

## Supported extensions (upload allowlist)

Images include `.heic` and `.heif`, case-insensitively.

What the composer lets the user pick is `imageExts`, `documentExts`, and
`textExts` (`src/shared/utils/file/fileExtensions.ts`) — images and documents
always, plus every linguist-recognized code extension and the `customTextExts`
additions (dotfiles, config, log, and domain formats such as `.conf`,
`.config`, `.yaml`, `.toml`, `.ini`) — with `audioExts`/`videoExts` added only
when the active model(s) support that modality. That union covers C# (`.cs`),
stylesheets (`.css`), shell scripts (`.sh`, `.bash`), and common configuration
files. Unknown extensions are not rejected outright — `isSupportedFile`
(`src/renderer/utils/file.ts`) falls back to a content sniff that accepts text
content. Unknown extensions with binary content are rejected with an aggregate
"N files are not supported" toast in the composer. On the request path, files
with no extension or an unrecognized extension (`FILE_TYPE.OTHER`) reach the
conservative decoder too. Binary bytes or legacy encodings too ambiguous to
decode safely produce a short unsupported-type note (see the routing matrix
above).

## HEIF/HEIC display and wire contract

| Boundary | Invariant |
|---|---|
| Admission | `.heic` and `.heif` are image extensions, case-insensitively; existing modality gates apply. |
| Storage | Original identity, filename and bytes stay unchanged. No derived FileEntry or persistent PNG is created. |
| Display | Composer hover, sent images and lightbox, desktop file-preview pane/tab and Files image activation use a main-process PNG rendition through `file.get_heif_rendition`. Chromium never receives raw HEIF for display. |
| Wire | Local entry, file URL and declared inline HEIF input become transient `image/png` data; a supplied filename becomes a PNG basename. First-party Claude Code vision input shares this preparation. |
| Failure | Invalid input, unavailable decoder, size limits, busy queue, inconsistent reads and soft timeout stop dispatch with localized guidance to retry or convert to JPEG/PNG. |
| Non-vision | HEIF OCR is not supported yet; reject before OCR. Ordinary image OCR is unchanged. |
| Files grid | Uses an icon. Thumbnails are deferred because Chromium cannot decode raw HEIF and the grid has no rendition lifecycle. Image activation still resolves a rendition. |
| External Claude Code | Path-only HEIF normalization is unsupported; the existing fallback forwards paths outside first-party preparation. Remote HEIF fetching is outside this contract. |

Renditions decode the primary top-level image (first top-level image if no primary
is exposed) at full resolution to 8-bit RGBA PNG, applying container transforms
once and preserving alpha. The main process runs one conversion at a time, with
at most eight waiting requests and 128 MiB of retained waiting inputs. Input and
PNG output each allow 64 MiB; each dimension must be a positive safe integer at
most 16,384, with at most 50,000,000 pixels. Equality is permitted. The 30-second
deadline starts at queue admission and is **soft**: synchronous WASM can block
main, and cancellation does not terminate decoding. These limits are not an RSS
ceiling. Encoded results use a content-hash LRU (16 entries, 64 MiB, five-minute
TTL); concurrent equal inputs coalesce and failures are not cached.

## The cap (the only context guard)

Extracted text is bounded so multi-turn context stays in control:

- text ≤ cap → inlined in full.
- text > cap → inline the first `cap` chars + a trailer:
  - tool-capable model: `[truncated N/total — call read_file("name", offset=N) for more]`
  - otherwise: `[truncated N/total]`

Default cap ≈ 8k chars/file (tunable).

## `read_file` — text-only overflow tool

`src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts`, using the
per-request attachment allow-list from the tool-call context.

- Input `{ filename, offset?, limit? }`. The `filename` is the model-facing
  **handle** (unique, normalized — see `collectFileAttachments`), resolved to an
  entry id against a per-request allow-list. The model never sees or guesses
  entry ids, and can only read files attached to the current conversation.
- Returns **text only** (extracted / OCR), paginated. Errors are sanitized to
  filename-level messages; details are logged, not returned.
- Exposed to tool-capable models whenever the request carries first-party file
  attachments (`applies: scope.hasFileAttachments`). It pages over-cap text; when
  everything inlines within the cap the model simply never needs to call it.
- Claude Code exposes the same read operation through the Cherry Assistant-only
  `assistant-files` MCP server. Its model-facing handles are stable, opaque
  hashes of FileEntry ids. The server rebuilds its allow-list from the current
  session transcript when each tool call runs, so deleting a message revokes
  access immediately. Ordinary Claude Code Agents receive neither this server
  nor its attachment manifest.
- Because native media is kept inline (never routed through the tool),
  `read_file` carries no media result — no `toModelOutput` base64 re-read, no
  resend re-materialization.

Cherry Assistant also gets approval-gated `save_attachment` from the same
session-scoped server. It writes only new paths inside the session workspace and
never overwrites an existing file. No attachment state or write tools are added
to the shared chat runtime or to ordinary Agents.

## Extraction & OCR

| Concern | Owner |
|---|---|
| office/pdf/text → text | `extractDocumentText` (`src/main/ai/messages/attachmentTextExtraction.ts`) |
| image → text (non-vision) | `FileProcessingService.ocrImage` (`src/main/features/fileProcessing/`) |

`ai/` reaches OCR through the `FileProcessingService` rather than deep-importing
the feature, keeping processor/handler internals in that domain. Both
`extractDocumentText` and the OCR path are path-free and cache their result by
content version (30 min), so the eager every-turn pass over history doesn't
re-extract or re-OCR the same file. `extractDocumentText` reads bytes through
`FileManager.read` (PDF via `pdf-parse`, office via
`officeparser`/`word-extractor`, known text extensions via
`decodeTextWithAutoEncoding`, and files with no extension or an unrecognized
extension (`FILE_TYPE.OTHER`) via `decodeTextBufferIfText`) and dispatches on
the `FileEntry` canonical `ext`. The conservative decoder returns `null` when
the bytes are binary or their legacy encoding is too ambiguous to decode safely.

## Capability resolution

`resolveNativeFileSupport`
(`src/main/ai/runtime/aiSdk/params/nativeFileSupport.ts`) derives the
"native" column from `(provider, model, resolved endpoint/runtime converter)`:
image rides on the model capability (`isVision`, `@shared/utils/model`);
audio/video require both the model capability and support from the selected AI
SDK converter. PDF additionally requires a first-party provider
(`supportsNativePdf`). There is no `pdf-compatibility` middleware — native PDFs
pass through inline, non-native PDFs go through extraction.

## Invariants

- Content visibility never depends on a tool call.
- `fileEntryId` never reaches the model (filename in, filename out).
- Native modalities keep provider-native handling.
- Models not configured for image input never receive native image parts.
- Per-turn context is bounded by the cap.
