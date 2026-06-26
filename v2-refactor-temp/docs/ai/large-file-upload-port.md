# Large-File Upload — Port Plan

> **Status update (2026-06-26):** the per-provider upload *mechanism* now exists — `src/main/services/remotefile/`
> (`BaseFileService` + `FileServiceManager` + `GeminiService` / `MistralService` / `OpenaiService`, each with
> `uploadFile` / `retrieveFile` / `deleteFile` / `listFiles` talking to the vendor Files API). So the "new"
> `fileService.uploadTo*` rows below are largely **already built**; the **remaining gap is the wiring** — `resolveFileUIPart`
> still base64-inlines and never calls `FileServiceManager`. Treat the table below as "where the dispatch should land",
> not "what to build from scratch". See also the AI SDK v7 `uploadFile` convergence at the end.

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

## AI SDK v7 `uploadFile` — the convergence target (v7-only)

v7 ships a provider-agnostic upload API that is exactly the unified version of `services/remotefile/`:

```ts
const { providerReference } = await uploadFile({
  api: openai.files(),                              // or google / anthropic / xai .files()
  data, filename,
  providerOptions: { openai: { purpose: 'assistants' } },
})
// attach to the message instead of base64:
{ type: 'file', data: providerReference, mediaType }   // providerReference = { [provider]: fileId }
```

- `ProviderReference` is a provider-keyed file-id map; **multi-provider merge** lets one uploaded file carry refs for
  several providers → switch model mid-conversation without re-upload (fits Cherry's multi-model use).
- **v7-only** (absent in v6 — `uploadFile`/`ProviderReference`/`.files()` not in `node_modules/ai`). Covers only
  providers with `.files()`: **anthropic / google / openai / xai**; others throw `UnsupportedFunctionalityError`.

**Implication for this port:**
1. **Do the wiring now on v6** using the existing `services/remotefile/` — large-file support does **not** need v7.
2. **Shape the reference part to converge:** have `resolveFileUIPart` emit `{ type:'file', data: { [providerId]: fileId } }`
   (mirroring `ProviderReference`) rather than a bespoke shape, so the v7 swap is internal.
3. **At v7:** replace `OpenaiService` / `GeminiService` internals with `uploadFile({ api: provider.files() })`. But
   **`MistralService`** (not in v7's `.files()` list) and any qwen-long / dashscope / openai-compatible providers stay
   hand-rolled — same first-party-vs-custom boundary as reasoning/`toolsContext`. So `services/remotefile/` shrinks, it
   doesn't disappear.
4. The reverse direction (URL → bytes) is the `download` function / `DEFAULT_MAX_DOWNLOAD_SIZE` — already in v6, no change.

## Out of scope here

- v1 block→part conversion (`convertFileBlockToTextPart` /
  `convertFileBlockToFilePart`). v2 Main operates on `data.parts` directly,
  so block conversion isn't on the critical path.
- OCR. PDF text extraction currently uses `extractPdfText` (`@shared/utils/pdf`).
  Swapping to a real OCR service is a separate epic.
