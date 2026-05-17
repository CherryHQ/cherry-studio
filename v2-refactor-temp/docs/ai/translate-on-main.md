# Translate-on-Main

## Why this is its own flow

In v1 the renderer composed everything: it picked the translate model from Redux, built the prompt by interpolating `{{target_language}}` / `{{text}}` against a Preference-stored template, and dispatched it through the same `streamText` pipe used for chat. That worked because chat owned the assistant, and translate piggy-backed on the assistant shape.

v2 broke that piggy-back deliberately:

- **No assistant for translate.** Translate has no system prompt, no MCP tools, no message history, no hooks, no telemetry. Every chat-side `RequestFeature` is a no-op for translate, so threading translate through `AiService.streamText({ assistantId, prompt })` makes the pipeline lie about what's happening.
- **Qwen-MT is structurally different.** Qwen-MT consumes raw text plus a `target_lang` provider option; there is no prompt to compose. The `if (isQwenMTModel) text else template(text, lang)` branch in `getDefaultTranslateAssistant` is a sign that "translate" is not one shape but two — and chat-side composition has no clean way to express that.
- **Persistence target is `translate_history`, not `messages`.** v2 already has `packages/shared/data/types/translate.ts` (entities) and `packages/shared/data/api/schemas/translate.ts` (DTOs) for it. The DataApi for history CRUD is wired; what's missing is the **execution** path that produces a row.

So translate-on-Main is its own request type with its own service, sharing nothing with chat beyond the underlying `AiService` provider adapters.

## Where it lives

```
src/main/
├── ai/
│   ├── AiService.ts                     ← lifecycle owner; registers translate IPC in onInit
│   └── agent/params/buildAgentParams.ts ← unchanged
└── services/
    └── translate/
        ├── translateService.ts          ← named-export singleton (NOT lifecycle)
        ├── prompts.ts                   ← template constants + interpolation
        ├── qwenMtMapping.ts             ← mapLanguageToQwenMTModel + variant table
        └── __tests__/
```

`translateService` is a **direct-import singleton**, not a `BaseService`. Per CLAUDE.md's lifecycle-decision guide, lifecycle is reserved for services that own long-lived resources or register persistent side effects. translate is stateless orchestration: each call resolves a model, builds a prompt, makes one LLM call, persists once, returns. No pool, no watcher, no on-disk handle.

The one persistent side effect — the `Translate_Run` IPC handler — rides on `AiService.onInit` (already lifecycle, already the IPC owner for the AI domain). `AiService` calls into `translateService.translate(req)` from inside the handler. No new lifecycle entry, no new `serviceRegistry` line.

## Request shape

```ts
// packages/shared/data/api/schemas/translate.ts (extend)
export const TranslateRequestSchema = z.object({
  sourceText: z.string().min(1),
  /** Auto-detect when omitted. */
  sourceLang: LangCodeSchema.optional(),
  targetLang: LangCodeSchema,
  /** Override the configured translate model for this call. */
  uniqueModelId: UniqueModelIdSchema.optional(),
  /** Persist into translate_history. Default true. */
  persist: z.boolean().default(true),
  /** Reasoning effort for translate models that support it. */
  reasoningEffort: ReasoningEffortSchema.optional()
})
```

Returns `{ targetText: string; sourceLang?: LangCode; historyId?: string }`.

## Service

```ts
// services/translate/translateService.ts
class TranslateService {
  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const model = await this.resolveModel(req)
    const isQwenMt = isQwenMTModel(model)

    const llmRequest = isQwenMt
      ? buildQwenMtRequest(req, model)
      : await buildPromptedRequest(req, model)

    const { text } = await application.get('AiService').generateText(llmRequest)

    if (req.persist) {
      const historyId = await translateHistoryService.create({
        sourceText: req.sourceText,
        targetText: text,
        sourceLanguage: req.sourceLang ?? null,
        targetLanguage: req.targetLang
      })
      return { targetText: text, historyId }
    }
    return { targetText: text }
  }

  private async resolveModel(req: TranslateRequest): Promise<Model> {
    /* read preference.feature.translate.model or req.uniqueModelId override */
  }
}

export const translateService = new TranslateService()
```

IPC registration sits inside `AiService.onInit` (the AI-domain lifecycle owner):

```ts
// ai/AiService.ts (additions)
import { translateService } from '../services/translate/translateService'

private registerIpcHandlers(): void {
  // ...existing Ai_* handlers
  this.ipcHandle(IpcChannel.Translate_Run, (_, req) => translateService.translate(req))
}
```

Key calls out:

- `translateService.translate(...)` is the public entry; renderer hits it through `window.api.translate.translate` → IPC → `AiService` handler → `translateService`.
- `application.get('AiService').generateText(...)` is the SAME entry point used by chat — but the request carries no `assistantId`, so all chat features short-circuit (their `applies(scope)` returns false because `scope.assistant` is undefined).
- `resolveModel` reads `preference.feature.translate.model` (or `req.uniqueModelId` override). Throws when unconfigured — renderer surfaces the error as today.

## Qwen-MT branch

Qwen-MT models accept raw text via `prompt` plus translation control through `providerOptions.dashscope.translation_options`. Use `extraFeatures` to inject the option at request time:

```ts
function buildQwenMtRequest(req: TranslateRequest, model: Model): GenerateTextArgs {
  return {
    request: {
      uniqueModelId: createUniqueModelId(model.providerId, model.id),
      prompt: req.sourceText
    },
    extraFeatures: [translateQwenMtFeature(req.targetLang, req.sourceLang)]
  }
}

const translateQwenMtFeature = (targetLang: LangCode, sourceLang?: LangCode): RequestFeature => ({
  name: 'translate-qwen-mt',
  applies: () => true,
  contributeModelAdapters: () => [
    definePlugin({
      name: 'qwen-mt-target-lang',
      enforce: 'pre',
      transformParams: async (params) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          dashscope: {
            translation_options: {
              target_lang: mapLanguageToQwenMTModel(targetLang),
              ...(sourceLang ? { source_lang: mapLanguageToQwenMTModel(sourceLang) } : {})
            }
          }
        }
      })
    })
  ]
})
```

`mapLanguageToQwenMTModel` lives at `src/main/services/translate/qwenMtMapping.ts` — port the table that previously lived in renderer's `config/translate.ts`. The earlier `src/main/ai/config/translate.ts` (deleted as dead code) was the half-port; it returns properly placed under translate, not ai.

## Prompted (non-Qwen-MT) branch

```ts
async function buildPromptedRequest(req: TranslateRequest, model: Model): GenerateTextArgs {
  const template = await preferenceService.get('feature.translate.model_prompt')
  const targetLanguage = await translateLanguageService.getByCode(req.targetLang)
  const prompt = template
    .replaceAll('{{target_language}}', targetLanguage.value)
    .replaceAll('{{text}}', req.sourceText)
  return {
    request: {
      uniqueModelId: createUniqueModelId(model.providerId, model.id),
      prompt
    }
  }
}
```

No `assistantId` — `buildAgentParams` sees `assistant: undefined`, every chat feature is gated off. The request lands as a pure `provider + model + prompt` call. `temperature` / `maxOutputTokens` come from translate-specific Preferences if set, otherwise model defaults.

## Persistence

`translateHistoryService` (existing DataApi) handles the row insert. `sourceLanguage: null` when source-lang is omitted — the schema is nullable and the renderer can backfill via subsequent edits if language detection runs later.

## Streaming (later)

The current renderer-side `translateText(_, _, onResponse)` accepts a streaming callback but the v2 IPC pipe is non-streaming. Two options when streaming is needed:

1. **Reuse `AiStreamManager`** with a synthetic topicId (`translate:${historyId}`). Adds chat-style multicast and abort for free; downside is dragging in a topicId concept that doesn't really fit translate.
2. **Dedicated translate stream IPC** via `MessageChannel` (similar to `generateImage`). Caller posts `'abort'`, Main posts incremental `'chunk'` then terminal `'done'`. AC scoped to handler; no service-side state.

Option 2 is structurally cleaner. Defer until a UX request actually demands streaming — current v2 translate pages are post-hoc renders, not conversational.

## What ships in PR 1

Minimum viable translate-on-Main:

- `services/translate/translateService.ts` (named-export singleton, non-streaming, prompted + Qwen-MT branches)
- `services/translate/qwenMtMapping.ts` (port the renderer table)
- `services/translate/prompts.ts` (template fetch + interpolation)
- `AiService.onInit` extended to register `IpcChannel.Translate_Run` → `translateService.translate`
- Preload bridge `window.api.translate.translate(...)`
- Renderer: `translateText` collapses to `await window.api.translate.translate({...})` — drops `getDefaultTranslateAssistant` entirely
- `__tests__` covering both branches + persist toggle

Out of scope for PR 1: streaming, source-language auto-detect, batch translate, language-detection cache.

## Why no `RequestFeature` for the prompted branch

Tempting to make "translate" a `RequestFeature` so it composes with internal features. But translate doesn't share the chat scope (no assistant, no MCP tools, no messages) — letting INTERNAL_FEATURES run against it would either fire no-ops (cosmetic but wasteful) or accidentally trigger features we don't want (e.g. anthropicCache on a one-shot 100-token translate is pointless and miscaches the prefix).

Keep translate's pipeline minimal and let the SHARED layer (`buildAgentParams` for sdkConfig + provider options + repair) be the only thing it borrows from chat. The Qwen-MT plugin is a one-feature `extraFeatures` injection — local to the translate call, doesn't leak back into chat scope.

## Open questions

- **Source-lang auto-detect.** v1 had a renderer-side `detectLanguage` using a separate LLM call (rejecting Qwen-MT models). Move this to TranslateService too, or keep on renderer? If translate is fully Main-side, detection should live next to it. Filing as a follow-up.
- **Per-call temperature override.** Translate quality is sensitive to temperature (low for literal, higher for fluent). Currently no UI surface. Either thread through `TranslateRequest` or pin to a Preference. Defer until product asks.
- **`translate_history` for system-initiated translations** (e.g. ActionTranslate from selection). The history feature was opt-in renderer-side; preserve that in `persist: boolean` on the request.
