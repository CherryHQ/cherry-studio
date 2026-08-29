---
description: Text translation flow from renderer callers through translate.open to Main streaming, including Home message persistence ownership
sources:
  - src/shared/ipc/schemas/translate.ts
  - src/main/ipc/handlers/translate.ts
  - src/main/services/translate/translateService.ts
  - src/renderer/utils/translate/translateText.ts
  - src/renderer/pages/home/messages/homeMessageListAdapter.tsx
---

# Text Translation

This document covers one-shot text translation through `translate.open`.
PDF translation uses the separate `translate.pdf.*` routes and
`PdfTranslationService`.

## Active flow

```text
MessageMenuBar
  -> MessageListActions.translateMessage
  -> homeMessageListAdapter.translateMessage
       |-> ChatWrite.editMessage(data-translation)
       `-> translateText
            -> ipcApi.request('translate.open', { streamId, text, targetLangCode })
            -> translateHandlers['translate.open']
            -> translateService.open
            -> AiStreamManager.streamPrompt
            -> WebContentsListener
            -> ai.stream.chunk / done / error
```

Other renderer surfaces, including TranslatePage and selection translation,
reach the same `translateText` helper through `useTranslate`. They consume the
returned text locally instead of attaching it to a chat message.

## Ownership

The responsibilities deliberately split at the renderer/Main boundary:

| Owner | Responsibility |
|---|---|
| Renderer caller | Decide what the translated text means and whether to persist it |
| `translateText` | Generate a stream ID, subscribe before opening, accumulate chunks, and bridge abort |
| `translate.open` handler | Validate the managed-window sender and delegate to the service |
| `translateService` | Resolve the configured model and language, build the prompt, gate the configured model parameters against that model, and open the prompt stream |
| `AiStreamManager` | Run the prompt stream and deliver chunks through `WebContentsListener` |

`translateService` is a direct-import singleton because it owns no long-lived
resource or persistent side effect. The lifecycle-owned `IpcApiService` owns
the persistent IPC registration.

## IPC contract

The renderer sends exactly three fields:

```ts
ipcApi.request('translate.open', {
  streamId,
  text,
  targetLangCode
})
```

- `streamId` is renderer-generated and must start with `translate:`. The
  namespace prevents collisions with real chat topic IDs when abort uses
  `ai.stream.abort({ topicId: streamId })`.
- `targetLangCode` must be a concrete configured language, not `unknown`.
- The renderer subscribes to `ai.stream.chunk`, `ai.stream.done`, and
  `ai.stream.error` before it calls `translate.open`, because Main starts the
  stream synchronously.

The route has no `messageId` or `sourceLangCode`. Main therefore has no message
target and cannot persist chat data from this route.

Model parameters do not cross the wire either. Temperature, top-p, max tokens
and reasoning effort live in Preference under `feature.translate.*`, so Main
reads them itself — every translate surface gets the same settings without
having to pass them, and a renderer cannot ask for a value the user did not
configure.

## Home message persistence

Home chat owns the message projection through its existing chat write boundary:

1. `homeMessageListAdapter.translateMessage` aborts any older translation for
   the same message.
2. It writes an empty `data-translation` part so the loading UI has a committed
   target.
3. Each accumulated response replaces that part through
   `ChatWrite.editMessage`; updates are serialized so a slower write cannot
   overwrite a later chunk.
4. Completion waits for pending writes. Failure or abort removes the loading
   part when that controller still owns the translation.

This keeps message persistence with the same owner as every other message edit.
Callers without a message target keep their result locally. `translate.open`
does not write `translate_history` rows.

## Why there is no translation overlay store

An older message-bound path mounted `useTranslateMessage`, wrote streamed text
into `TranslationOverlayContext`, passed `messageId` to `translate.open`, and
attached a Main-side `TranslationBackend`. The Home message menu was later
moved to `homeMessageListAdapter.translateMessage`; no production caller of
`useTranslateMessage` remained.

That orphaned branch was removed instead of adding a keyed external store or a
Cache key. There is no independent temporary-state owner to coordinate:

- the active stream state is local to the Home adapter;
- the user-visible translation is message business data written through
  `ChatWrite`;
- other translation callers own their returned text locally.

Reintroducing an overlay or Cache-backed store requires a concrete production
consumer and a lifecycle that the existing caller-owned flow cannot satisfy.

## Validation

- `src/renderer/utils/translate/__tests__/translateText.test.ts` covers stream
  IDs, chunk accumulation, terminal events, errors, and abort.
- `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx`
  covers keeping the translation active until its final write settles.
- `src/main/services/translate/__tests__/translateService.test.ts` covers
  model/prompt resolution, request validation, and stream dispatch.
- `src/main/ipc/handlers/__tests__/translate.test.ts` covers sender resolution
  and handler delegation.
