# Translate-on-Main

> The current source of truth is
> [Text Translation](../../../docs/references/ai/translation.md). This file
> records the v2 design outcome and is not an API reference.

## Final boundary

The v2 migration moved model selection, prompt construction, and provider
streaming into Main without making translation a chat turn:

```text
renderer translateText
  -> IpcApi translate.open
  -> translateService.open
  -> AiStreamManager.streamPrompt
  -> WebContentsListener
  -> renderer ai.stream.* subscribers
```

Translation has no assistant, message history, tools, or chat
`RequestFeature` stack. Qwen-MT receives raw text plus its provider-scoped
`translation_options`; other models receive the configured translation prompt.

`translateService` remains a direct-import singleton. It owns no long-lived
resource or persistent side effect; the lifecycle-owned IpcApi layer owns route
registration.

## Persistence outcome

`translate.open` is a chunks-only route with `{ streamId, text,
targetLangCode }`. It has no message target and does not write message or
translation-history data.

Home chat persists the current `data-translation` part through
`homeMessageListAdapter.translateMessage` and `ChatWrite.editMessage`. Other
callers keep the accumulated result locally.

The earlier optional `messageId` / `sourceLangCode` request fields,
renderer-side translation overlay, and Main-side `TranslationBackend` lost
their production consumer when Home moved to the page adapter. They were
removed rather than optimized as an external store or Cache entry.

## Open questions

- **Source-language detection.** `useDetectLang` remains renderer-owned.
- **Translation history.** Text translation does not currently write
  `translate_history` rows.
- **Gating for assistant-less callers.** #19693. #9884 gave translate its own
  temperature / top-p / reasoning-effort preferences, but it has to gate them
  against the model itself before putting them on `callOverrides`; folding that
  back into the request pipeline is still open.
