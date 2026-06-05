# Large-File Upload — Port Plan

## What's missing on Main

`src/main/ai/messages/fileProcessor.ts::resolveFileUIPart` currently inlines
file contents as base64 data URLs. For provider-native File APIs (Gemini File,
OpenAI Files) this is wrong above ~20 MB / a few MB respectively — it either
blows past payload limits or burns large amounts of tokens on base64
re-encoding. The renderer used to upload via `window.api.fileService` and
reference by URI / `fileid://…`; that path has not been ported.

## What to port

A Main-side equivalent of the deleted renderer module
`src/renderer/src/aiCore/prepareParams/fileProcessor.ts`, specifically the
three exports:

| Renderer export | Main equivalent (new) | Notes |
|---|---|---|
| `handleGeminiFileUpload(file, model)` | `fileService.uploadToGemini(provider, file)` | Talks to `@google/genai` `files.upload` directly |
| `handleOpenAILargeFileUpload(file, model)` | `fileService.uploadToOpenAI(provider, file)` | Talks to `openai.files.create`; respect `purpose='file-extract'` for qwen-long / qwen-doc |
| `handleLargeFileUpload(file, model)` | dispatch wrapper used by `resolveFileUIPart` | Routes by `getAiSdkProviderId(provider)` |

And the capability helpers (was `prepareParams/modelCapabilities.ts`):

- `supportsImageInput(model)` — alias for `isVisionModel`
- `supportsLargeFileUpload(model)` — `qwen-long` / `qwen-doc` or Gemini family
- `getFileSizeLimit(model, fileType)` — Anthropic PDF 32 MB / Gemini 20 MB / Dashscope-large-upload 0 / others `Infinity`

## Wiring on Main

1. **File access** — replace every `window.api.file.*` /
   `window.api.fileService.*` with the Main `FileStorage` service
   (`src/main/services/FileStorage.ts`: `getFilePathById`, `base64File`,
   `base64Image`). Add a Main-side `fileService.upload(provider, file)` /
   `fileService.retrieve(provider, fileId)` that talks to the provider SDK's
   Files API.
2. **Provider lookup** — replace `getProviderByModel(model)` with an async
   `providerService.getByModelId(uniqueModelId)` or have the caller pass
   `Provider` in.
3. **User-facing errors** — replace `window.toast.*` / `i18next` with logger
   warnings; the caller decides how to surface failure (chat-side overlay,
   silent skip, …).
4. **Dispatch** — in `resolveFileUIPart`, before falling back to base64
   inlining, call `handleLargeFileUpload(file, model)` when `file.size >
   getFileSizeLimit(model, fileType)` and `supportsLargeFileUpload(model)`.
5. **FileMetadata** — v2 `FileBlock` / `ImageBlock` carry only `fileId`. The
   helpers above expect a `FileMetadata` (with `size`, `ext`, `type`,
   `origin_name`). Either synthesise one in `resolveFileUIPart` or extend
   `FileStorage` with `getMetadataById(fileId)`.

## Reference source

The renderer implementation was kept in-repo as a verbatim copy at
`src/main/ai/messages/largeFileUpload.ts` during the early port. It has since
been deleted — the original renderer file
(`src/renderer/src/aiCore/prepareParams/fileProcessor.ts` on `origin/main`)
remains the canonical reference until this port lands.

## Out of scope here

- v1 block→part conversion (`convertFileBlockToTextPart` /
  `convertFileBlockToFilePart`). v2 Main operates on `data.parts` directly,
  so block conversion isn't on the critical path.
- OCR. PDF text extraction currently uses `extractPdfText` (`@shared/utils/pdf`).
  Swapping to a real OCR service is a separate epic.
