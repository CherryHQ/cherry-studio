---
description: Main-as-writer tool approval through ai.tool.respond_approval, approval-requested parts, and persistent MCP decisions
sources:
  - src/main/ai/AiService.ts
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/ipc/handlers/ai.ts
  - src/renderer/hooks/useToolApprovalBridge.ts
  - src/renderer/components/chat/messages/tools/hooks/useToolApproval.ts
  - src/main/ai/runtime/claudeCode/settingsBuilder.ts
  - src/main/ai/runtime/claudeCode/streamAdapter.ts
  - src/main/ai/runtime/claudeCode/ToolApprovalRegistry.ts
  - src/main/ai/runtime/claudeCode/hooks.ts
  - src/main/ai/toolApproval/ToolApprovalRegistry.ts
  - src/main/ai/toolApproval/builtinToolPolicy.ts
  - src/main/ai/mcp/createMcpBridgeServer.ts
  - src/main/ai/mcp/McpRuntimeService.ts
  - src/main/ai/mcp/mcpRequestOptions.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/connections/ExternalMcpConnection.ts
  - src/main/ai/tools/adapters/claudeCode/agentTools.ts
  - src/shared/ai/tools/mcpSourcePolicy.ts
  - src/shared/ai/claudecode/toolRules.ts
  - src/renderer/components/composer/variants/PermissionRequestComposer.tsx
  - src/renderer/components/chat/messages/tools/toolResponse.ts
  - src/renderer/components/chat/messages/tools/shared/ArgsTable.tsx
  - src/shared/ipc/schemas/ai.ts
---

# Tool Approval

## Model

Main is the single writer of approval state. The renderer surfaces an
`approval-requested` ToolUIPart, takes the user's decision, and posts it
to Main. Main applies the decision to the DB-authoritative anchor parts,
persists, and resumes the stream.

## End-to-end flow

1. **Tool needs approval** — at `execute` time, the wrapper checks
   `tool.needsApproval` and the assistant's auto-approve policy. If
   approval is required, the wrapper writes an `approval-requested` part
   and resolves the tool's promise into a held state (agent-session runtime:
   holds its registered approval; MCP: stream pauses on the approval part).

2. **Stream pauses** — `AiStreamManager` transitions the topic to
   `awaiting-approval`. The `topic.stream.statuses.<topicId>` shared-cache
   entry carries the status; every renderer window reading that key sees
   the pause atomically.

3. **User decides** — the approval card renders from the part. On click,
   `useToolApprovalBridge` (`src/renderer/hooks/useToolApprovalBridge.ts`)
   calls `ipcApi.request('ai.tool.respond_approval', ...)` with `approvalId`,
   `approved`, optional `reason` / `updatedInput`, `topicId`, `anchorId`.

4. **Main applies** — the IpcApi handler in `src/main/ipc/handlers/ai.ts`
   delegates to `AiService.respondToolApproval`, which branches on transport
   **before** touching the topic-message DB:
   - **Agent-session registry path**: hands the decision to
     `AgentSessionRuntimeService.respondToolApproval`, which settles any
     persisted interaction card and dispatches the live approval registry
     entry so the existing runtime proceeds. When a live entry handles it, the handler
     **early-returns — no DB read happens** (and `topicId` / `anchorId`
     are not required).
   - **MCP path** (reached only when no live entry matched; requires
     `topicId` + `anchorId`): reads the anchor message's current `parts`
     from DB, applies the decision, and **writes only when the target
     `approval-requested` part is present on the DB row** — guarding the
     overlay-only case (approval received before the part has persisted).
     When all approvals on the turn are decided it dispatches a synthetic
     `continue-conversation` request through `dispatchStreamRequest`; the
     provider applies the decision when it reads parts.

5. **Awaiting-approval clears** — the moment the continue stream
   broadcasts `pending`, the shared-cache entry flips back. Every window
   sees the approval card disappear in the same tick.

## Persistent decisions

`useToolApproval`
(`src/renderer/components/chat/messages/tools/hooks/useToolApproval.ts`)
exposes an `autoApprove` action **only for MCP tools** — when an `mcpTool`
descriptor is passed. It persists the opt-out by PATCHing the server's
`disabledAutoApproveTools`, so the MCP settings page reflects it and
subsequent calls of that tool skip the approval card. There is no generic
per-tool default for non-MCP agent-runtime tools.

For what a single approval authorizes, see [External MCP per-call approval guarantees](#external-mcp-per-call-approval-guarantees).

## External MCP per-call approval guarantees

These guarantees describe external MCP per-call approval in the Claude Code
agent runtime; other runtimes' approval paths are not covered here.

### Approved arguments

The executed arguments are the ones the approval decision received. The dialog
has no argument editor: approve sends `{ match, approved: true }`; deny sends
`{ match, approved: false, reason }`. Neither sets `updatedInput`
(`src/renderer/components/composer/variants/PermissionRequestComposer.tsx:225`).
The IPC route schema still permits `updatedInput`
(`src/shared/ipc/schemas/ai.ts:332`).

Main stores `originalInput: input` and resolves the decision against that input
(`src/main/ai/runtime/claudeCode/settingsBuilder.ts:611`). Because this dialog
does not set `updatedInput`, the decision adapter returns `originalInput`
unchanged as the SDK's execution input
(`src/main/ai/runtime/claudeCode/ToolApprovalRegistry.ts:16`).

The rendered card is not byte-bound to that object: the stream approval chunk
carries only IDs, the card uses earlier streamed tool input, and a configured
`PreToolUse` hook may rewrite input before approval
(`src/main/ai/agentSession/AgentSessionRuntimeService.ts:2582`,
`src/main/ai/runtime/claudeCode/streamAdapter.ts:1954`,
`src/renderer/components/chat/messages/tools/toolResponse.ts:238`,
`src/main/ai/runtime/claudeCode/settingsBuilder.ts:335`). The pinned
`@anthropic-ai/claude-agent-sdk` 0.3.284 (`package.json:134`) permits this through
`PreToolUseHookSpecificOutput.updatedInput`. The renderer also
cannot distinguish every JSON value type: the string `"false"` and boolean
`false` render identically
(`src/renderer/components/chat/messages/tools/shared/ArgsTable.tsx:10`).

The bridge forwards `request.params.arguments` directly
(`src/main/ai/mcp/createMcpBridgeServer.ts:256`). The normalisation step parses
string arguments as JSON, with an empty or whitespace-only string becoming `{}`;
objects pass through untouched (`src/main/ai/mcp/McpRuntimeService.ts:716`).
The connection sends `{ name, arguments: args ?? {} }`
(`src/main/ai/mcp/connections/ClientMcpConnection.ts:327`). This is an argument
value guarantee, not a promise of byte-identical JSON serialization.

### Execution and failures

At Cherry's runtime layer, MCP tool errors and timeouts do not trigger
automatic re-execution. An `isError: true` result is returned directly; thrown
errors are logged and rethrown (`src/main/ai/mcp/McpRuntimeService.ts:757`) through the bridge
(`src/main/ai/mcp/createMcpBridgeServer.ts:262`), reaching the model as a tool
error once the client has finished its internal handling.

The pinned `@modelcontextprotocol/client` 2.3.0 (`package.json:262`) can make
repeated `tools/call` requests inside the same approval through `Client#callTool`.
With the client's header mirroring active (`modern` protocol era outside a
browser), a `-32020 HeaderMismatch` triggers a one-shot retry: evict and refresh
`tools/list`, then issue `tools/call` again with the same params. Cherry
passes no `toolDefinition`, so that retry path is enabled
(`src/main/ai/mcp/connections/ClientMcpConnection.ts:327`); the first error is
not necessarily what the model sees.

The client also enables `input_required` auto-fulfilment with a ten-round cap
(`src/main/ai/mcp/connections/ClientMcpConnection.ts:95`). Its SDK-level
`input_required` continuation repeats the same `tools/call` method with the
original params plus `inputResponses` and/or `requestState` as supplied by the
continuation. A server
handler can therefore be entered again inside one approved call. Neither this
continuation nor the header-mismatch retry re-enters the approval check; an
absolute "never retried automatically" is not a property of the implementation.

The connected request and its continuations have a default 60,000 ms budget;
a server's `timeout` overrides it in seconds only when truthy
(`src/main/ai/mcp/mcpRequestOptions.ts:18`). The schema accepts `timeout: 0`
(`src/shared/data/types/mcpServer.ts:72`), but zero falls back to 60,000 ms
rather than disabling the timer. `longRunning` resets the request
timer on progress with a ten-minute total cap
(`src/main/ai/mcp/mcpRequestOptions.ts:18`), enforced by the connection's abort
signal (`src/main/ai/mcp/connections/ClientMcpConnection.ts:267`). Connection
establishment happens before that budget starts and is governed separately,
with a 180,000 ms floor (`src/main/ai/mcp/McpRuntimeService.ts:736`,
`src/main/ai/mcp/McpRuntimeService.ts:123`, `src/main/ai/mcp/McpRuntimeService.ts:378`).
The connection retry gate records `retryAt` and limits subsequent connection
attempts; it does not itself reconnect or re-execute the failed call
(`src/main/ai/mcp/McpRuntimeService.ts:457`, `src/main/ai/mcp/McpRuntimeService.ts:517`).

Each new model tool call that reaches the per-call decision branch of
`canUseTool` gets a fresh `approvalId`
(`src/main/ai/runtime/claudeCode/settingsBuilder.ts:513`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:599`).
Dispatch consumes that approval entry once, without memoising by tool name or
arguments (`src/main/ai/toolApproval/ToolApprovalRegistry.ts:88`). SDK permission
suggestions (`permission_suggestions` / `permissionSuggestions`) are unused.
The MCP portion of the pre-approved tool list contains built-in tool policies
only; user-defined MCP tools are excluded (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:507`,
`src/main/ai/runtime/claudeCode/settingsBuilder.ts:715`, `src/main/ai/toolApproval/builtinToolPolicy.ts:40`).
The complete `allowedTools` list also includes `TaskCreate`, `TaskGet`,
`TaskUpdate`, and `TaskList`, filtered by `disallowedTools`
(`src/main/ai/runtime/claudeCode/settingsBuilder.ts:288`,
`src/main/ai/runtime/claudeCode/settingsBuilder.ts:356`).

### Boundaries

| Condition | Current behavior |
|---|---|
| `disabledAutoApproveTools` | Source policy forces listed tools to `approval: 'prompt'` before mode defaults, including `bypassPermissions` (`src/shared/ai/tools/mcpSourcePolicy.ts:35`, `src/main/ai/tools/adapters/claudeCode/agentTools.ts:77`, `src/shared/ai/claudecode/toolRules.ts:68`). That resolver result is not by itself a dialog: the callback must be reached and the background auto-allow must not apply; source-forced prompt alone does not set `requiresUserResponse` (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:549`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:571`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:577`). |
| `bypassPermissions` (Full Access) | Auto-approves unless source policy takes precedence in the resolver (`src/shared/ai/claudecode/toolRules.ts:82`, `src/shared/ai/claudecode/toolRules.ts:116`). The SDK skips the callback on auto-approved paths, so the resolver alone does not guarantee per-call confirmation (`src/main/ai/runtime/claudeCode/hooks.ts:87`). |
| `acceptEdits` | Auto-approves the built-in edit-tool set, not arbitrary external MCP tools (`src/shared/ai/claudecode/toolRules.ts:31`, `src/shared/ai/claudecode/toolRules.ts:86`). |
| No interactive responder | A call requiring a user response is denied when no responder is available; a missing approval emitter also denies. Ordinary background requests can auto-allow before these guards (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:577`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:585`, `src/main/ai/runtime/claudeCode/settingsBuilder.ts:602`). |
| `disabledTools` | Tools are omitted from exposure, and runtime calls are rejected; this is not an approval decision (`src/main/ai/tools/adapters/claudeCode/agentTools.ts:78`, `src/main/ai/mcp/McpRuntimeService.ts:728`). |
| Explicit `updatedInput` from another caller | The decision adapter accepts replacement input; argument fidelity above describes this dialog, not every possible approval sender (`src/main/ai/runtime/claudeCode/ToolApprovalRegistry.ts:16`). |
| OAuth authentication challenge | The URL transport can resend a request rejected before acceptance after credentials are reloaded or authorization completes, within the same approval (`src/main/ai/mcp/connections/ExternalMcpConnection.ts:260`). |

## Why this design

- **No renderer writes** — the renderer cannot PATCH approval state. If
  it did, it would race Main's authoritative re-read and cause the
  approval card to reappear on every click.
- **Cross-window consistency** — the shared-cache `awaiting-approval`
  status is the single source of truth for "this topic is paused".
- **Overlay/persist gap** — the renderer sometimes sees the
  `approval-requested` part via overlay before it lands in the DB row.
  Writing unconditionally would clobber the (concurrent) Main-side
  persistence; the conditional write + continue-dispatch covers that case.

## Where to read more

- IpcApi route: `src/main/ipc/handlers/ai.ts` (`ai.tool.respond_approval`)
- Main decision owner: `src/main/ai/AiService.ts` (`respondToolApproval`)
- Renderer bridge: `src/renderer/hooks/useToolApprovalBridge.ts`
- Persistent decisions: `src/renderer/components/chat/messages/tools/hooks/useToolApproval.ts`
- Status broadcast: [Stream Manager](./stream-manager.md)
