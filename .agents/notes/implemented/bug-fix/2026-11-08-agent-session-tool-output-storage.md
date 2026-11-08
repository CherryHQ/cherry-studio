# Agent Note: Agent session message timeout and oversized tool output storage

Status: implemented

English | [中文](2026-11-08-agent-session-tool-output-storage.zh.md)

## Problem

`GET /agent-sessions/:sessionId/messages` timed out against the renderer DataApi 3s budget during active Agent execution and when opening tool-heavy sessions:

1. `agent_session_message.data` stored full tool outputs inline inside the message JSON. Because `better-sqlite3` and `JSON.parse(row.data)` run synchronously on the Electron main thread, paging a session (`limit=50`) parsed every oversized tool output in the page even though the list query immediately stripped those payloads into `$deferredToolResult` markers via `projectMessagesOutputForRenderer`.
2. During streaming and terminal persistence, `AgentSessionMessageService.upsertMessage` / `replaceMessageParts` re-serialized the entire message `data` JSON (including already-completed large tool outputs) and fired the `agent_session_message_au` FTS5 trigger unconditionally on every row update (including metadata-only updates such as `parentId`), re-running `json_each(NEW.data, '$.parts')` and FTS delete/insert in SQLite.
3. `projectToolOutputForRenderer` ran `JSON.stringify(output)` twice per oversized tool output (`measureJsonBytes` and `computeToolOutputRevision`) and ran four citation Zod schemas (`safeParse`) against every tool output regardless of payload shape.
4. `RootMessageProjection` queried `hasSessionMessage` (`SELECT *` + `rowToEntity`) and `getSessionMessage` once per range instead of once per unique `messageId`, and `ChildThreadProjection` invoked `readAgentSessionPath` twice in its constructor.
5. `ai.message.readToolOutput` loaded and parsed the full `agent_session_message` row only to extract a single `toolCallId`.

## Decision

This storage layer sits above the [tool result Spec](../architecture/2026-11-09-tool-result-projection-boundaries.md). It removes the sidecar revision column and keeps one latest output per call. The final implementation uses targeted invalidation without result revisions; its architecture note records the cumulative storage, projection and detail verification.

1. **Dedicated sidecar table (`agent_session_tool_output`)**:
   - Added `agent_session_tool_output` (`message_id`, `tool_call_id`, `session_id`, `output`, `created_at`, `updated_at`) with composite primary key `(message_id, tool_call_id)` and `ON DELETE CASCADE` foreign keys to `agent_session_message(id)` and `agent_session(id)`.
   - On write (`upsertMessage`, `replaceMessageParts`, `updateSessionMessage`, `insertForkMessagesTx`, `resolveCrashOrphanedMessages`), `AgentSessionMessageService` extracts completed tool outputs exceeding `DEFER_TOOL_OUTPUT_BYTES` (32 KiB) into `agent_session_tool_output` and stores only the compact `$deferredToolResult` marker (reference identifiers `sessionId`, `messageId`, `toolCallId`, `revision`, and optional `excerpt` and `skeleton`) in `agent_session_message.data`.
   - `syncMessageToolOutputsTx` replaces the current output at the same `(message_id, tool_call_id)` key. `setWhere: output IS NOT excluded.output` skips writes when serialized content is unchanged, without a stored result revision. The update reuses `excluded.output` rather than serializing the same value again.
2. **Deferred vs hydrated reads**:
   - `listSessionMessages(sessionId, { deferToolOutputs: true })` reads `agent_session_message` directly without querying `agent_session_tool_output` for rows persisted under the split layout, while still projecting legacy inline rows in memory for backward compatibility.
   - Callers that require full tool outputs (`getSessionMessage`, `listApprovalMessages`, `findCrashOrphanedAssistantMessages`, `readAgentSessionPath`, `readRetiredAgentSessionHistory`, and `listSessionMessages` without `deferToolOutputs`) batch-hydrate `$deferredToolResult` markers from `agent_session_tool_output` in `SQLITE_INARRAY_CHUNK` chunks.
   - `getSessionToolOutput(sessionId, messageId, toolCallId)` and `findPersistedToolOutput` perform an O(1) point lookup on `agent_session_tool_output` first, falling back to `getSessionMessage` only for legacy unsplit rows or inline outputs.
   - `agentSessionMessageEntityJsonBytes()` accounts for offloaded sidecar byte deltas so diagnostic metadata paging (`listLiveCreatedInRangeMetadataPage`) remains byte-identical to `JSON.stringify(getSessionMessage(sessionId, id))`.
3. **Hot-path and FTS trigger guards**:
   - `agent_session_message_au` now specifies `WHEN OLD.data IS NOT NEW.data` so metadata-only row updates skip FTS5 re-tokenization.
   - `projectToolOutputForRenderer` serializes oversized outputs once via `serializeOversizedToolOutput` and gates `toCitationPayloadSkeleton` on payload shape (`Array.isArray(output)` or `typeof output.conceptId === 'string'`) before running Zod schemas.
   - `RootMessageProjection` deduplicates `hasSessionMessage` (now `SELECT id` only) and `getSessionMessage` per `messageId`, and `ChildThreadProjection` reuses a single `readAgentSessionPath` read during construction.

## Alternatives considered

- **Increase the renderer `/agent-sessions/:sessionId/messages` timeout to 15s (PR #23718)**: rejected because it masks main-thread blocking instead of reducing synchronous SQLite I/O or JSON serialization cost.
- **Reuse legacy Chat's `aiSdk/contextBuild` (`$persistedToolOutput` + `FileManager` filesystem blobs)**: rejected because Chat will converge onto `agent-runtime` as an Agent Profile and the legacy `aiSdk` Chat message pipeline will be retired; coupling `agent-runtime` to legacy Chat's file-blob lifecycle would invert the target architecture and complicate transactional cascade cleanup on session/branch deletion.
- **Run a boot-time backfill migration over all existing `agent_session_message` rows**: rejected because O(N) data rewrites at startup risk slow boots on large databases; lazy coexistence (reading legacy inline rows seamlessly and splitting on write) achieves full compatibility with zero startup cost.

## Consequences

- Split message rows exclude oversized tool bodies, so compact paging avoids parsing those bodies. This does not establish a universal paging latency or eliminate other synchronous streaming work.
- Deleting a session, message, or branch automatically cleans up offloaded tool outputs via SQLite `ON DELETE CASCADE` within the same transaction.
- Legacy messages persisted before this change remain readable without a destructive migration.

## Verification

- Regression — `pnpm test:main src/main/data/services/__tests__/AgentSessionMessageService.test.ts`: verifies write-time offloading into `agent_session_tool_output`, compact deferred reads, hydrated default/single reads, `getSessionToolOutput` point lookups, `entityJsonBytes` parity, unchanged-content skip and same-call latest-output replacement on `replaceMessageParts`, and cascade deletion.
- Regression — `pnpm test:main src/main/ai/runtime/pi/__tests__/retiredSessionHistory.test.ts`: verifies crash-orphan recovery followed by retired DSH session history import hydrates oversized tool outputs into resumed Pi context.
- Regression — `pnpm test:main src/main/utils/__tests__/messageOutputProjection.test.ts src/main/ai/messages/__tests__/readConversation.test.ts src/main/ipc/handlers/__tests__/ai.test.ts`: verifies single-pass projection, citation skeleton preservation, and O(1) `ai.message.readToolOutput` lookup.
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/RootMessageProjection.test.ts src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts`: verifies deduplicated message lookups and single-pass child archive initialization.
- Regression — `pnpm test:main src/main/data/db/__tests__/applyMigrations.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts src/main/data/db/__tests__/ftsRebuild.test.ts`: verifies migration `0036_agent_session_tool_output.sql` and `WHEN OLD.data IS NOT NEW.data` FTS trigger integrity.
