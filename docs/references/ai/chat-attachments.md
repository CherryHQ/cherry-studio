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
(`src/main/ai/messages/attachmentManifest.ts`):

| Attachment | Native when | What the model receives |
|---|---|---|
| image | model is vision | native image part (inline) |
| image | non-vision | OCR text, inline (capped) |
| pdf | provider+model native PDF | native PDF part (inline) |
| pdf | otherwise | extracted text, inline (capped) |
| office (`docx/xlsx/pptx/odf`) | — | extracted text, inline (capped) |
| text / code | — | decoded text, inline (capped) |
| audio | model is audio-capable | native audio part (inline) |
| audio | otherwise | short note ("can't process audio") |
| video | model is video-capable | native video part (inline) |
| video | otherwise | short note ("can't process video") |

- **Native** → the file part is left in place and inlined as a `data:` URL by
  `resolveFileUIPart` (`src/main/ai/messages/fileProcessor.ts`), which also
  normalizes the `mediaType` to the on-disk MIME. The provider gets the real
  file as a user-message part.
- **Non-native** → the file part is replaced by its extracted text (see the
  cap below). The internal `fileEntryId` is never written into the prompt.

Only `fileEntryId`-backed (first-party chat) attachments are routed. Gateway /
external file parts (no `fileEntryId`) are left untouched, so the OpenAI-
compatible passthrough is unaffected.

## The cap (the only context guard)

Extracted text is bounded so multi-turn context stays in control:

- text ≤ cap → inlined in full.
- text > cap → inline the first `cap` chars + a trailer:
  - tool-capable model: `[truncated N/total — call read_file("name", offset=N) for more]`
  - otherwise: `[truncated N/total]`

Default cap ≈ 8k chars/file (tunable).

## `read_file` — text-only overflow tool

`src/main/ai/tools/fileLookup.ts` + `tools/adapters/aiSdk/builtin/ReadFileTool.ts`.

- Input `{ filename, offset?, limit? }`. The model references files by
  **filename**, resolved to an entry id against a per-request allow-list
  (`collectFileAttachments`) — the model never sees or guesses entry ids, and
  can only read files attached to the current conversation.
- Returns **text only** (extracted / OCR), paginated. Errors are sanitized to
  filename-level messages; details are logged, not returned.
- Exposed to tool-capable models whenever the request carries first-party file
  attachments (`applies: scope.hasFileAttachments`). It pages over-cap text; when
  everything inlines within the cap the model simply never needs to call it.
- Because native media is kept inline (never routed through the tool),
  `read_file` carries no media result — no `toModelOutput` base64 re-read, no
  resend re-materialization.

## Extraction & OCR

| Concern | Owner |
|---|---|
| office/pdf/text → text | `extractDocumentText` (`src/main/utils/file/documentExtraction.ts`) |
| image → text (non-vision) | `ocrImageToText` (`src/main/features/fileProcessing/ocrImageToText.ts`) |

Both `extractDocumentText` and `ocrImageToText` are path-free and cache their
result by content version (30 min), so the eager every-turn pass over history
doesn't re-extract or re-OCR the same file. `extractDocumentText` reads bytes
through `FileManager.read` (PDF via `pdf-parse`, office via
`officeparser`/`word-extractor`, text via `decodeTextWithAutoEncoding`) and
dispatches on the `FileEntry` canonical `ext`.

## Capability resolution

`resolveNativeFileSupport`
(`src/main/ai/runtime/aiSdk/params/fileToolCapabilities.ts`) derives the
"native" column from `(provider, model)`: image/audio/video ride on the model
capability alone (`isVision` / `isAudio` / `isVideo`, `@shared/utils/model`),
while PDF additionally requires a first-party provider (`supportsNativePdf`).
There is no `pdf-compatibility` middleware — native PDFs pass through inline,
non-native PDFs go through extraction.

## Invariants

- Content visibility never depends on a tool call.
- `fileEntryId` never reaches the model (filename in, filename out).
- Native modalities keep provider-native handling.
- Per-turn context is bounded by the cap.
