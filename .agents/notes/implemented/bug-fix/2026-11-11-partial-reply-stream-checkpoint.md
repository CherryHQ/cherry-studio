# Agent Note: Keep a partial reply when the app stops mid-stream

Status: implemented

English | [中文](2026-11-11-partial-reply-stream-checkpoint.zh.md)

## Problem

A reply was written only when its stream ended. If the app crashed, quit, or its window closed mid-stream, the next boot found the assistant row still `pending` and settled it as an empty `error`: the text the user had already watched arrive was gone, and history showed a reply that had never produced anything. Chat topics and agent sessions both behaved this way, and the agent-session path additionally had delivery-owned turns whose recovery read a projection with the streaming fields stripped.

## Decision

While an execution streams, `AiStreamManager` hands its latest accumulated message to `StreamListener.onCheckpoint` at most once per `checkpointIntervalMs` (1 s). `PersistenceListener` forwards it to the backend's optional `checkpoint(parts)`, and the SQLite and agent-session backends store it as `data.streamCheckpoint` on the `pending` row.

The checkpoint sits **beside** `data.parts`, never inside it: a reconnecting renderer seeds its reader from the row's `parts` and replays the stream buffer on top, so partial parts there would render twice. It lives in the existing JSON `data` column, so no schema migration is involved, and it is a main-only field — every public read strips it, and the `stream_checkpoint` shape is declared once as `StreamCheckpointedData` with a single `withoutStreamCheckpoint` helper rather than re-derived per call site.

The boot reconcile (`AiStreamManager` for chat, `AgentSessionRuntimeService` and `recoverSessionDeliveries` for agent sessions) settles each stale `pending` row through `interruptedReplyData`: it prefers `streamCheckpoint` over the placeholder's parts, closes the live parts, appends a `data-error` part carrying `i18nKey: 'reply_interrupted'`, and drops the checkpoint in the same write. Settling is what ends a checkpoint's life, so the rule is centralized: a terminal write rebuilds `data` without it, a settle that only rewrites the status removes it in the same statement, and a write that leaves the row `pending` keeps it.

Checkpoint writes are synchronous and frequent, so they keep only what is cheap to rewrite: empty content and transient status parts are dropped as before, and a terminal tool output larger than `CHECKPOINT_MAX_TOOL_OUTPUT_CHARS` is dropped outright instead of being moved to FileManager the way the terminal write does. The FTS triggers on both tables now rebuild only when `$.parts` actually changed, because `searchable_text` derives from the parts alone and a checkpoint write leaves them untouched.

## Alternatives considered

- Writing every chunk: turns each token into a database write.
- Keeping the partial text only in memory: a crash or quit is precisely the case that has to survive.
- Writing partial parts into `data.parts`: duplicates the text for any renderer that reconnects from the row while the stream is still live.
- A dedicated `stream_checkpoint` column: cleaner ownership, and a nullable `ALTER TABLE ... ADD COLUMN` would not rebuild the table, but it is a schema migration for a field whose readers all already strip it.
- Trimming oversized tool outputs at checkpoint time instead of dropping them: the persisted envelope points at a FileManager blob, and the write is synchronous per second, so the blob cannot be created there; an envelope without its blob would render content that no longer exists.
- Leaving the FTS triggers after a write of phaseless parts: correct output, but it re-tokenizes the whole message once per second per live stream.

## Consequences

A reply cut off by a crash, a quit, or a closed tab now keeps everything checkpointed and ends with an interrupted notice instead of an empty error; at most the last second of text is lost. Oversized tool outputs are absent from a recovered reply. Each streaming execution still rewrites its row's `data` once per second, so a very long reply costs a proportional write per interval. The main-only field lives inside the public `data` JSON, so correctness depends on every read, settle, and copy path going through the shared helper.

## Verification

- Regression — `interruptedReplyData` prefers the checkpoint, falls back to the row's parts, drops the field, and keeps main-authoritative keys beside the parts.
- Regression — settling through a status-only write drops the checkpoint, while a patch that leaves the row `pending` keeps it (chat and agent-session services).
- Regression — `PersistenceListener.onCheckpoint` is a no-op for a backend without `checkpoint`, swallows a failing backend, drops an oversized tool output, and ignores another `modelId`'s execution.
- Regression — a copied pending message no longer carries the checkpoint into the settled copy.
- Limitation — no Electron crash/restart acceptance run in this change; the boot reconcile is covered by service-level tests on a real SQLite database.
