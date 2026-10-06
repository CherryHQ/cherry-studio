---
description: Main-as-writer tool approval through ai.tool.respond_approval, approval-requested parts, and persistent MCP decisions
sources:
  - src/main/ai/AiService.ts
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/ai/toolApproval/builtinToolPolicyRegistry.ts
  - src/main/ai/runtime/claudeCode/guardRules.ts
  - src/main/ai/runtime/pi/approvalExtension.ts
  - src/main/ai/mcp/servers/cherryAutonomyTools.ts
  - src/main/ipc/handlers/ai.ts
  - src/renderer/hooks/useToolApprovalBridge.ts
  - src/renderer/components/chat/messages/tools/hooks/useToolApproval.ts
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

## Built-in Agent delegation on scheduled turns

The persistent MCP decisions above do not pre-authorize the built-in
`session_send` or `session_create` tools. Both require live per-call approval,
including in `bypassPermissions` (Full Access) and when the recipient is a
sibling Session of the same Agent. Scheduled, channel, and delivery-triggered
turns without an approval responder are denied before either tool executes;
`reuse_session: true` does not make a scheduled turn interactive.

For a scheduled coordinator, keep the notice in its output and, when the turn
has configured notification recipients, use `notify` to inform the user. To
send it to a sibling Session, return to an interactive sender turn and approve
that `session_send` call. This is a manual handoff, not unattended cross-Session
routing; `notify` delivers to configured channel recipients, not to a Session.
A denied send has not created a delivery to retry automatically.

Runtime-generated completion results for an already accepted request can
return to its immutable sender without another model tool call. See the
[deliberate security ceiling](./agent-session-runtime.md#deliberate-security-ceiling)
for this supported return path and the authorization, ancestry, cycle, and
budget requirements for any future unattended delegation policy.

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
