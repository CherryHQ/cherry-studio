# Agent Note: Bound agent session message reads before loading payloads

Status: implemented

English | [中文](2026-11-03-agent-session-message-read-budget.zh.md)

## Problem

Issue #23359 reports an allocation failure while reading agent session history. The old `listSessionMessages` path materialized full rows and parsed their JSON before the handler could defer large tool outputs. A message-count limit did not bound payload bytes, so projecting the response afterwards could not protect the read itself. A failed first page could also appear as an empty session in the renderer.

## Decision

`src/main/data/services/AgentSessionMessageService.ts` owns the read budget and projection. `listSessionMessages` uses a synchronous deferred read-only transaction: first read only metadata with SQL `coalesce(octet_length(column), 0)` for `limit+1` rows, then preflight the per-message and page input budgets. The sentinel determines only `hasNext`; it consumes no budget and its payload is never read. For each page id, load the row by primary key with `.get()`, run `rowToEntity`, optionally project it, and check the returned-entity budget before retaining it. Compute `nextCursor` after processing the page.

The per-message input budget is 16 MiB (`AGENT_SESSION_MESSAGE_READ_INPUT_BUDGET`). The page input budget is 512 MiB with `deferToolOutputs=true`, and 16 MiB when omitted or false. The page returned-entity budget is 16 MiB. Every comparison rejects only `>`; equality is allowed.

A budget violation throws a `DataApiError` with `INVALID_OPERATION`, `isRetryable=false`, and `details.reason=AGENT_SESSION_MESSAGE_READ_BUDGET_EXCEEDED`, including `operation/scope/sessionId/messageId/bytes/budget/deferToolOutputs`. Native `SQLITE_NOMEM` and `SQLITE_IOERR_NOMEM` are recognized along the `cause` chain and reported as `AGENT_SESSION_MESSAGE_READ_ALLOCATION_FAILED` with `nativeCode` and `stage`. Other exceptions propagate unchanged.

Projection moves from the handler into the service through `ListSessionMessagesOptions.deferToolOutputs`. The default remains false and returns public entities with their original content. With true, each message is projected using the existing `projectMessagePartsForRenderer`; its 32 KiB threshold, citation skeleton, and `$persistedToolOutput` envelope semantics are unchanged.

`useAgentSessionParts` exposes the query `error` and suppresses `loadOlder` while an error is present. `useAgentChatRuntimeState` forwards `historyError`. Above the message list, `AgentChat` uses the existing `Alert`, `common.error`, and `formatErrorMessage` to show the failure; a failed first page no longer counts as an empty session.

## Alternatives considered

- Keep projection in the handler: rejected because the service has already materialized and parsed the page before projection can reduce it.
- Rely on message-count paging alone: rejected because a small number of messages can still exceed the input budget; metadata must be checked before reading payloads.
- Catch allocation errors without a preflight budget: rejected because a V8 heap abort terminates the process rather than returning a recoverable query error.
- Defer tool outputs for every consumer: rejected because default and false reads must preserve the public entity content used by internal consumers; those reads instead use the smaller page input budget.

## Consequences

The service checks input size before payload reads and avoids retaining a page of unprojected entities when deferral is enabled. The metadata check and payload reads share one synchronous transaction. Budget rejection is explicit and non-retryable; the renderer displays history failure rather than silently presenting an empty session.

The same safety rejection applies to default-false internal consumers: remote journal/query, doctor, `readConversation`, and attachment reads. Oversized history can fail through these paths too. This is the selected policy, not a silent behavior introduced by this PR.

The 16/512 MiB limits are an explicit safety policy, not an absolute OOM guarantee for arbitrary data shapes or memory pressure. Reading 50×8 MiB still takes hundreds of milliseconds on the main thread. The original Windows `SQLITE_NOMEM` report was not reproduced; V8 low-heap `SIGABRT` is not equivalent to a Windows native allocation failure. Real Electron UI acceptance and CI results are outside this round's evidence and are not claimed here.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main` with explicit filters for `AgentSessionMessageService.test.ts`, `agentSessionMessages.test.ts`, `agentSessionMessages.list.test.ts`, `messageOutputProjection.test.ts`, `ApiServer.test.ts`, `agent.test.ts`, `agentPagination.test.ts`, `doctorIncident.test.ts`, `readConversation.test.ts`, and `AssistantFileToolsServer.test.ts`: 10 files / 255 passed, covering the service, handler, projection, and affected consumers.
- Regression — Shared validation in this round: 1 file / 10 passed; `tsc -p tsconfig.node.json`, oxlint, eslint, and oxfmt exited 0.
- Regression — `--project renderer` with explicit filters for `useAgentSessionParts.test.ts`, `AgentChatHistoryError.test.tsx`, `useAgentChatRuntimeState.test.tsx`, and `DataApiService.test.ts`: 4 files / 83 passed; `tsc -p tsconfig.web.json`, lint, and format exited 0, covering error propagation, visible history failure, and pagination behavior.
- Regression — Isolated child-process comparison with `--max-old-space-size=64`, 3 runs per old/new path, 4×8 MiB with true: old path 3/3 SIGABRT (V8 `JsonParser` OOM); new implementation 3/3 complete responses with correct refs and read-stage sampled RSS 197.83–199.61 MiB.
- Regression — The same low-heap comparison, 50×8 MiB with true: old path 3/3 abort; new implementation 3/3 success, read-stage sampled RSS 198.58–199.50 MiB, synchronous duration 420–575 ms.
- Regression — The same low-heap comparison, a single 64 MiB message: old path 3/3 abort; new implementation 3/3 rejected before payload reads (`rejectedPayloadGets=0`), then read a healthy small page and exited 0.
- Regression — Default/false reads of 4×8 MiB and 50×8 MiB were rejected by the `page-input` preflight (`rejectedPayloadGets=0`); healthy small pages remained readable afterwards.
