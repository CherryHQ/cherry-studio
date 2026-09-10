---
description: The two text translation entry points — translate.open for callers that know their target language, translate.task.* for the Main-owned chain that survives a window detach — and Home message persistence ownership
sources:
  - src/shared/ipc/schemas/translate.ts
  - src/main/ipc/handlers/translate.ts
  - src/main/services/translate/TranslateService.ts
  - src/main/services/translate/TranslateTask.ts
  - src/main/services/translate/detectLanguage.ts
  - src/shared/data/preference/preferenceSchemas.ts
  - src/renderer/utils/translate/translateText.ts
  - src/renderer/hooks/translate/useTranslateTask.ts
  - src/renderer/pages/translate/TranslateSettings.tsx
  - src/renderer/pages/translate/useTranslateReasoningEffort.ts
  - src/renderer/pages/home/messages/homeMessageListAdapter.tsx
---

# Text Translation

This document covers text translation. PDF translation uses the separate
`translate.pdf.*` routes and `PdfTranslationService`.

There are two entry points, and which one a caller uses depends on one question:
does Main have to own the flow, or only the stream?

| Entry point | For | Callers |
|---|---|---|
| `translate.open` | The target language is already decided, so there is no chain to own — only a stream, which `AiStreamManager` already owns | Home message translation, quick-assistant translate window, selection translate, skill file browser |
| `translate.task.*` | The target depends on a detection step, and the whole chain has to outlive the renderer | TranslatePage |

## `translate.open`: stream only

```text
MessageMenuBar
  -> MessageListActions.translateMessage
  -> homeMessageListAdapter.translateMessage
       |-> ChatWrite.editMessage(data-translation)
       `-> translateText
            -> ipcApi.request('translate.open', { streamId, text, targetLangCode })
            -> translateHandlers['translate.open']
            -> TranslateService.open
            -> TranslateService.startStream(listener: WebContentsListener)
            -> AiStreamManager.streamPrompt
            -> ai.stream.chunk / done / error
```

Other renderer surfaces on this route — the quick-assistant translate window,
selection translation, the skill file browser — reach the same `translateText`
helper through `useTranslate`. They consume the returned text locally instead of
attaching it to a chat message.

## `translate.task.*`: the whole chain

A translation is not always one call. When the source language must be detected
first — TranslatePage's `auto` source, and its bidirectional pair — the flow is
detect, then decide the target from what came back, then stream. Keeping that
chain in the renderer meant a window detach destroyed it: detach rebuilds the
renderer, taking with it not just the in-flight promise but which step the flow
was on. Main is the only process that outlives that.

```text
TranslatePage
  -> useTranslateTask
  -> ipcApi.request('translate.task.start', { text, sourceLangCode, targetLangCode, bidirectional, bidirectionalPair })
  -> TranslateService.startTask  ->  new TranslateTask
       |-> detectLanguageOrUnknown                    -> translate.task.state
       |-> determineTargetLanguage                    -> translate.task.failed (same / not-pair)
       `-> TranslateService.startStream(listener: the task itself)
            -> AiStreamManager.streamPrompt
            -> ai.stream.chunk / done / error         -> translate.task.completed / failed
```

The task is the stream's listener rather than the window being one: it
accumulates the text and forwards to whichever window is attached. That is what
makes a detach survivable — the rebuilt renderer calls `translate.task.attach`
with the id its tab session kept, gets back what it missed, and the task swaps
its forwarder.

## Ownership

The responsibilities deliberately split at the renderer/Main boundary:

| Owner | Responsibility |
|---|---|
| Renderer caller | Decide what the translated text means and whether to persist it |
| `translateText` | Generate a stream ID, subscribe before opening, accumulate chunks, and bridge abort |
| Tab session | Hold the running task's id and end it when the tab ends — not when a page unmounts |
| `translate.*` handlers | Validate the managed-window sender and delegate to the service |
| `TranslateService.startStream` | Resolve the configured model and language, build the prompt, gate the configured model parameters against that model, and put the stream on the wire for a caller-supplied listener |
| `TranslateService.open` | The two checks that belong to an IPC boundary — a `translate:`-prefixed stream ID and a concrete target language — then `startStream` |
| `TranslateTask` | Own one translation end to end: detect, resolve the target, listen to the stream, accumulate, forward to the attached window, and settle exactly once |
| `AiStreamManager` | Run the prompt stream and deliver chunks to the listener it was given |

`TranslateService` is lifecycle-owned (`@ServicePhase(Phase.WhenReady)`) because
it holds the registry of running tasks: a task outlives the call that started it,
and `onStop` has to cancel what is still running. `open` predates the registry
and touches none of it — it resolves and dispatches, then returns.

Both entry points share `startStream`, and the listener is the only thing that
differs. A window receives directly; a task listens itself, which is what lets it
re-forward after a detach.

## IPC contract

### `translate.open`

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

Model parameters do not cross the wire either. Temperature, top-p and reasoning
effort live in Preference under `feature.translate.*`, so Main reads them itself
in `startStream` — every translate caller gets the same settings without having
to pass them, and a renderer cannot ask for a value the user did not configure.
(Layout-preserving PDF translation does not go through this route:
`PdfTranslationService` drives BabelDoc via the API gateway and reads none of
`feature.translate.*`.)

### Task routes

`translate.task.start` takes the source and target the user configured, plus the
bidirectional pair, and returns two ids: `taskId` for the task's own milestones
and `streamId` for the text, which still rides `ai.stream.*` exactly as before.
The task reports through four events — `translate.task.state` (currently only the
detected source language), `.completed`, `.aborted`, `.failed`.

`translate.task.cancel` ends a task wherever it is: with the stream open it
aborts the stream, and before that it aborts the detection request through an
`AbortSignal`, so a cancelled translation does not leave an LLM call running with
nobody left to read it. `translate.task.attach` re-points a task at the calling
window and returns what it missed; `undefined` means the task already settled.

`translate.detect` exposes detection on its own, for callers that want a language
without running a translation. It degrades to `unknown` rather than failing, as
does the detection step inside a task: a detection that cannot answer is not a
translation that cannot run.

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
- `src/main/services/translate/__tests__/TranslateService.test.ts` covers
  model/prompt resolution, model-parameter gating, request validation, and
  stream dispatch.
- `src/main/services/translate/__tests__/TranslateTask.test.ts` covers the chain:
  no stream before detection resolves, cancellation during detection, the window
  watch, re-attach, and the terminal events.
- `src/main/services/translate/__tests__/detectLanguage.test.ts` covers each
  detection method and every way detection can decline to answer.
- `src/main/ipc/handlers/__tests__/translate.test.ts` covers sender resolution
  and handler delegation.
