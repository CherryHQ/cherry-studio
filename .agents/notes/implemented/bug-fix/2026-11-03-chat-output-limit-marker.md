# Agent Note: Preserve and display the chat output-limit reason

Status: implemented

English | [中文](2026-11-03-chat-output-limit-marker.zh.md)

## Problem

An ordinary Chat assistant reply ending with the AI SDK's normalized `finishReason === 'length'` looks complete: the UI shows no truncation notice, and the persisted message has `status: 'success'` without a record of why generation stopped. A user cannot distinguish a complete answer from one cut off at the model's output limit, including after reloading history.

## Decision

The AI SDK runtime's `Agent` supplies `{ finishReason }` through `toUIMessageStream({ messageMetadata })` on the final `finish` event. The reason belongs to the assistant message, not to a topic or a group of parallel model replies.

`MessageServiceBackend` copies only this scalar from the final message's metadata into `MessageData` in SQLite's existing `data` JSON. `TemporaryChatBackend` retains the same field in its in-memory message data. The shared contract accepts an optional normalized `FinishReason`; it does not persist the entire runtime metadata object. There is no new column or migration, and historical messages without the field remain valid without backfill.

`messageProjection` restores the stored reason into UI message metadata, and `messageListItem` carries live or restored metadata into the rendering contract. For an assistant message with `finishReason === 'length'`, `MessageContent` displays the localized `message.finish_reason.length` notice beneath the body, even when the body has no parts. The notice has `role="status"` and `aria-live="polite"`.

An otherwise successful length-limited completion remains `success`; the marker adds no error part, terminal status, or toast. A `stop` reason or an absent reason shows no marker. The Pi runtime behavior owned by #22331 is unchanged.

## Alternatives considered

- Treat `length` as an error or introduce a new terminal status. This conflates a completed provider request with transport or execution failure and changes existing success handling merely to explain incomplete output.
- Carry the reason in a `data-*` part. The reason describes completion of the whole message, not an ordered content block; the SDK's message metadata carries it without adding a custom part protocol.
- Store local state only in the renderer's `onFinish`. Main owns final-message persistence independently of the renderer. Local state cannot record the reason in Main's stored row, survive history reload, or give other windows the same marker when they read that row.

## Consequences

Newly completed Chat replies retain the reason through live rendering and history reads without changing their terminal classification. Temporary conversations retain it only for their existing in-memory lifetime. Older replies cannot show a reliable truncation marker because their stop reason was not recorded; the UI does not infer it from text or status. The marker explains the output limit but does not continue or regenerate an answer automatically.

## Verification

The focused unit checks below passed in the preceding implementation round, as recorded in its validation report. They were not rerun in this documentation-only round. C-04 is added coverage, not executed Electron/E2E evidence.

- Regression — `src/shared/data/types/__tests__/message.test.ts`: accepts normalized reasons and historical data without the field; rejects invalid values including raw provider `max_tokens`.
- Regression — `src/main/ai/streamManager/persistence/backends/__tests__/TemporaryChatBackend.test.ts`: retains the final message's `length` reason in temporary assistant message data when persisting a successful completion.
- Regression — `src/renderer/utils/message/__tests__/messageProjection.test.ts`: restores persisted `finishReason: 'length'` into UI message metadata.
- Regression — `src/renderer/components/chat/messages/utils/__tests__/messageListItem.test.ts`: projects the streamed `length` reason while the message is still pending.
- Regression — `src/renderer/components/chat/messages/frame/__tests__/MessageContent.test.tsx`: renders a visible accessible notice with an empty body and omits it for `stop` or an absent reason.
- Regression — `tests/e2e/regression/03-models-and-assistants.test.ts` C-04 (added, not run): asserts no marker before final finish, then preserved partial text and a visible marker; checks stored `success`, `finishReason: 'length'`, and absence of `data-error`; reloads the same message ID and checks the marker; a subsequent `stop` reply has no marker while the earlier marker remains.
