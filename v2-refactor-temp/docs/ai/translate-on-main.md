# Translate-on-Main

## Why this is its own flow

In v1 the renderer composed everything: it picked the translate model from
Redux, built the prompt by interpolating `{{target_language}}` / `{{text}}`
against a Preference-stored template, and dispatched it through the same
`streamText` pipe used for chat. That worked because chat owned the
assistant, and translate piggy-backed on the assistant shape.

v2 broke that piggy-back deliberately:

- **No assistant for translate.** Translate has no system prompt, no MCP
  tools, no message history, no hooks, no telemetry. Every chat-side
  `RequestFeature` is a no-op for translate, so threading translate
  through `AiService.streamText({ assistantId, prompt })` makes the
  pipeline lie about what's happening.
- **Qwen-MT is structurally different.** Qwen-MT models accept raw text
  with no system prompt to compose. The `if (isQwenMTModel) text else
  template(text, lang)` branch is structural — translate isn't one
  shape but two — and chat-side composition has no clean way to express
  that.
- **Persistence target is the per-message `data-translation` part, not
  the chat `data.parts` content.** v2 surfaces translations as a sticky
  part on the source message (the MessageMenubar "translate this reply"
  flow); orphan callers (TranslatePage, ActionTranslate) get the
  streamed chunks without any persistence.

So translate-on-Main is its own request type with its own service,
sharing nothing with chat beyond the underlying `AiStreamManager`
provider plumbing.

## Where it lives

```
src/main/
├── ai/
│   ├── AiService.ts                                       ← lifecycle owner; registers Ai_Translate_Open in onInit
│   └── stream-manager/
│       ├── AiStreamManager.ts                             ← streamPrompt() entry consumed by translate
│       ├── listeners/{WebContentsListener,PersistenceListener}.ts
│       └── persistence/backends/TranslationBackend.ts     ← writes data-translation part on the source message
└── services/
    └── translate/
        ├── translateService.ts                            ← named-export singleton (NOT lifecycle)
        └── __tests__/
```

`translateService` is a **direct-import singleton**, not a `BaseService`.
Per CLAUDE.md's lifecycle-decision guide, lifecycle is reserved for
services that own long-lived resources or register persistent side
effects. Translate is stateless orchestration: each call resolves a
model, builds a prompt, hands the prompt to `AiStreamManager.streamPrompt`
with the right listeners, and returns the synthetic streamId. No pool,
no watcher, no on-disk handle.

The one persistent side effect — the `Ai_Translate_Open` IPC handler —
rides on `AiService.onInit` (already lifecycle, already the IPC owner
for the AI domain). `AiService` calls into `translateService.open(sender,
req)` from inside the handler. No new lifecycle entry, no new
`serviceRegistry` line.

## Request shape

```ts
// src/main/services/translate/translateService.ts
export interface TranslateOpenRequest {
  /** Renderer-generated, must be prefixed `translate:`. */
  streamId: string
  /** Source text. */
  text: string
  /** Target language code; resolved to a DTO via translateLanguageService. */
  targetLangCode: TranslateLangCode
  /**
   * When present, attach a `PersistenceListener + TranslationBackend`
   * so the final translation is written as a `data-translation` part on
   * that message. Used by the MessageMenubar "translate this reply"
   * flow; omit for orphans (ActionTranslate, TranslatePage).
   */
  messageId?: string
  /**
   * Optional pre-detected source language; recorded on the
   * `data-translation` part when persistence runs. Main does not detect
   * by itself.
   */
  sourceLangCode?: TranslateLangCode
}

export interface TranslateOpenResult {
  streamId: string
}
```

The renderer generates the `streamId` so it can subscribe to
`Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError` **before** invoking
`open` — Main starts the stream synchronously inside `open()`, so the
first chunk can land between `open()`'s resolution and any post-await
subscriber registration.

## Service

```ts
// src/main/services/translate/translateService.ts
class TranslateService {
  async open(sender: Electron.WebContents, req: TranslateOpenRequest): Promise<TranslateOpenResult> {
    // streamId prefix + target-lang validation (throws on misuse)
    const targetLanguage = await translateLanguageService.getByLangCode(req.targetLangCode)
    const { uniqueModelId, content } = await this.resolveTranslatePayload(req.text, targetLanguage)

    const listeners: StreamListener[] = []
    if (req.messageId) {
      listeners.push(new PersistenceListener({
        topicId: req.streamId,
        backend: new TranslationBackend({
          messageId: req.messageId,
          targetLanguage: req.targetLangCode,
          sourceLanguage: req.sourceLangCode
        })
      }))
    }
    listeners.push(new WebContentsListener(sender, req.streamId))

    application.get('AiStreamManager')
      .streamPrompt({ streamId: req.streamId, uniqueModelId, prompt: content, listener: listeners })

    return { streamId: req.streamId }
  }
}

export const translateService = new TranslateService()
```

IPC registration sits inside `AiService.onInit`:

```ts
// ai/AiService.ts
this.ipcHandle(IpcChannel.Ai_Translate_Open, async (event, req: TranslateOpenRequest) =>
  translateService.open(event.sender, req)
)
```

`streamPrompt` runs the `promptStreamLifecycle` (no broadcast,
single-execution, prompt-mode). The same provider adapters chat uses
are reused; translate just doesn't supply an assistant scope.

## Model + prompt resolution

```ts
async resolveTranslatePayload(text, targetLanguage) {
  const modelIdRaw = preferenceService.get('feature.translate.model_id')
  if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) throw new Error('translate.error.not_configured')
  const { providerId, modelId } = parseUniqueModelId(modelIdRaw)
  const model = await modelService.getByKey(providerId, modelId)
  if (!model) throw new Error('translate.error.not_configured')

  const content = isQwenMTModel(model)
    ? text
    : preferenceService.get('feature.translate.model_prompt')
        .replaceAll('{{target_language}}', targetLanguage.value)
        .replaceAll('{{text}}', text)

  return { uniqueModelId: createUniqueModelId(providerId, modelId), content }
}
```

- **Configured model**: `feature.translate.model_id` (a `UniqueModelId`
  string `${providerId}::${modelId}`). Unset → throws
  `translate.error.not_configured`, the renderer surfaces it as an i18n
  toast.
- **Prompted branch** (default chat-style models): interpolate
  `feature.translate.model_prompt` with the target language label.
- **Qwen-MT branch**: send raw text. The model handles language
  routing internally — current code passes nothing in
  `providerOptions.dashscope.translation_options`; see Open questions.

## Persistence

When `req.messageId` is provided, a `PersistenceListener` carrying a
`TranslationBackend` runs on stream success. The backend:

1. Reads the target message.
2. Strips any prior `data-translation` part (replace, not append).
3. Appends a fresh `data-translation` part with `{ content,
   targetLanguage, sourceLanguage? }`.

Paused / errored terminals are no-ops — discard-on-cancel. The DB write
completes before `Ai_StreamDone` because `dispatchToListeners` awaits
serially, so renderer revalidation on `done` always sees the new part.

No `translate_history` table is written. That table type exists in
`packages/shared/data/types/translate.ts` but is not currently
populated by this flow — see Open questions.

## Streaming

Option 1 from the original design (reuse `AiStreamManager` with a
synthetic topicId, `translate:${uuid}`) shipped instead of the dedicated
`MessageChannel` route. Rationale in practice:

- The renderer already had `Ai_StreamChunk` / `Ai_StreamDone` /
  `Ai_StreamError` subscriptions wired for chat; filtering by the
  prefixed streamId reuses that surface with one extra string prefix
  test.
- Abort flows through `Ai_Stream_Abort({ topicId: streamId })` — same
  channel as chat, no second AC plumbing.
- The `translate:` prefix on the topicId is defensive: keeps `Ai_Stream_Abort`
  from colliding with a real chat topic, and lets log filtering tell
  the two apart.

Concrete renderer surface (`src/renderer/src/services/TranslateService.ts`):

```ts
translateText(
  text: string,
  targetLanguage: TranslateLangCode | TranslateLanguage,
  onResponse?: (accumulated: string, isComplete: boolean) => void,
  signal?: AbortSignal
): Promise<string>
```

`onResponse` paces UI updates (e.g. via `useSmoothStream`); `signal`
maps to `Ai_Stream_Abort`.

## Why no `RequestFeature` for the prompted branch

Tempting to make "translate" a `RequestFeature` so it composes with the
internal feature stack. But translate doesn't share the chat scope (no
assistant, no MCP tools, no messages) — letting `INTERNAL_FEATURES` run
against it would either fire no-ops (cosmetic but wasteful) or
accidentally trigger features we don't want (e.g. anthropicCache on a
one-shot 100-token translate is pointless and miscaches the prefix).

Keep translate's pipeline minimal and let the shared `streamPrompt`
plumbing be the only thing it borrows from chat.

## Open questions / known gaps

- **Qwen-MT `target_lang` parameter.** Current code sends raw text with
  no `providerOptions.dashscope.translation_options.target_lang`. Either
  Qwen-MT auto-routes (untested) or this is a regression vs. v1. If a
  fix is needed, a one-off `extraFeatures` plugin on the translate call
  is the right local injection point (it won't leak back into chat
  scope).
- **Source-lang auto-detect.** Renderer-side `useDetectLang` does the
  detection (and rejects Qwen-MT for detection); detected language is
  passed in as `sourceLangCode` on the request. Whether to move
  detection to Main remains open.
- **`translate_history` writes.** The renderer-side opt-in
  `history-enabled` knob from v1 has no current Main-side equivalent.
  When/if this lands, a `TranslateHistoryBackend` parallel to
  `TranslationBackend` would be the place — both implement
  `PersistenceBackend`, so a translate call could carry zero, one, or
  both backends through the same listener.
- **Per-call temperature override.** Translate quality is sensitive to
  temperature (low for literal, higher for fluent). No UI surface today;
  defer until product asks.
