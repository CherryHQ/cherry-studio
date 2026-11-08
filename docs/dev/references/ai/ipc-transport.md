---
description: Desktop AI commands and shared root/child message projection subscriptions over IpcApi
sources:
  - src/renderer/hooks/useStreamCommands.ts
  - src/renderer/services/aiTransport/StreamDispatchService.ts
  - src/renderer/services/aiTransport/MessageProjectionService.ts
  - src/renderer/services/aiTransport/ToolResultService.ts
  - src/renderer/hooks/useToolResult.ts
  - src/main/ai/messages/toolResultRead.ts
  - src/shared/ai/transport/stream.ts
  - src/shared/ipc/schemas/ai.ts
  - src/main/ipc/handlers/ai.ts
---

# IPC Transport

## Commands and observation

Desktop consumers send commands through `useStreamCommands` or the existing conversation turn controller. They observe assistant output through the shared message projection store. Input admission and observation have separate lifetimes.

| Operation | Route | Owner |
|---|---|---|
| Submit or regenerate | `ai.stream.open` | `AiStreamManager.dispatchCommand` and the selected context provider |
| Stop and await teardown | `ai.stream.abort` | `AiStreamManager.abortAndDrain` |
| Attach a topic or child view | `ai.projection.attach` | Topic manager or child runtime owner |
| Release one observation lease | `ai.projection.detach` | Window-scoped projection subscriptions |
| Deliver a message update | `ai.projection.changed` | Directed IpcApi event to the subscribed window |
| Read deferred tool details | `ai.tool.get_result` | Latest accepted live result or persisted message output |
| Resolve approval | `ai.tool.respond_approval` | Existing tool approval owner |
| Send input to a child | `ai.agent.child.message` | Native child owner, if available |

The attach/detach requests carry a discriminated target (`topicId`, or parent `sessionId` plus child lookup `toolCallId`) and an ephemeral subscription ID. Snapshots and patches use `CherryUIMessage`; owner state carries activity/availability or per-execution terminal facts. See [Execution Overlay](./execution-overlay.md) for revision recovery and baseline scope.

Detach only removes a delivery lease. It never aborts a model or releases a native child. Stop is an explicit command whose promise resolves after Main drains the execution and terminal persistence, including the Agent runtime teardown needed before retry.

## Input and dispatch results

`submit-message` carries `userMessageParts` and the selected parent/model/request controls. `regenerate-message` carries the existing parent anchor instead of creating another user message. Approval-driven continuation is a Main command triggered by `ai.tool.respond_approval`, not inferred from renderer message content.

`streamDispatchService` returns and broadcasts the admission result, including reserved messages, active executions and branch-preservation facts. Existing optimistic-message consumers keep this result path. Blocked admission uses the existing localized toast; request failures reach the command caller. The service does not serialize submissions: Main arbitrates concurrent input, chat steering and Agent follow-ups.

`useStreamCommands` retains local input messages for temporary views, fences late command failures after a topic switch, and reads runtime errors from the same shared projection used by the message list. It does not create another stream subscription or parse model chunks.

## Tool result reads

A deferred result is addressed by `{ topicId, messageId, toolCallId }`. The reference identifies the latest value; it carries no content revision and cannot retrieve an older result. `ai.tool.get_result` requires an explicit `purpose`:

| Purpose | Ready response | Limit |
|---|---|---|
| `preview` | Structured `output` plus `truncated` | At most 32 KiB for the serialized UTF-8 response; fields and collections may be shortened |
| `text-range` | Serialized JSON text (or legacy envelope blob text) plus optional `nextCursor` | At most 256 KiB of UTF-8 text per read; `cursor` is a byte offset, defaulting to zero |
| `full` | Complete `output` | Explicit full-value consumers such as copy and export; no preview truncation |

`status: 'ready'` carries the requested purpose. The current handler returns `unavailable` when neither the live owner nor persisted output can resolve the identity. The protocol also permits `pending`; consumers retry it on relevant invalidation or reattachment. Neither availability status changes the tool execution state, and `unavailable` is not an execution failure.

Ordinary deferred cards fetch details when opened. Generic readers page serialized text; specialized cards use bounded previews. Copy and export request `full` explicitly. A replacement invalidates the current reader and restarts pagination from byte zero; cursors do not pin historical values.

Each renderer shares a latest-value LRU bounded to 16 MiB of serialized UTF-8 responses. It deduplicates active reads and fences obsolete completions locally, without an immutable SWR cache or content-version keys. A full response larger than that budget reaches its explicit mounted consumer but is not retained in the shared cache. Closing the last conversation observer releases that topic's cached and in-flight ownership while preserving other observers. Projection replacement, reattachment and relevant persisted-message changes invalidate retained details; ordered delivery is described in [Execution Overlay](./execution-overlay.md).

## Status and other transports

`useTopicStreamStatus(topicId)` still reads `topic.stream.statuses.<topicId>` from shared cache. Sidebar status, read receipts and approval anchors remain cross-window mirrors; message bodies travel through directed projection delivery.

The low-level `ai.stream.attach/detach` and chunk events remain available for existing raw-stream consumers. SSE, channel and one-shot prompt listeners keep their stream-specific contracts. Desktop root/child views no longer use chunk replay or `IpcChatTransport`.

## Related references

- [Execution Overlay](./execution-overlay.md) — projection publication and recovery.
- [Tool Approval](./tool-approval.md) — approval ownership and persistent decisions.
- [Stream Manager](./stream-manager.md) — Main execution and persistence.
