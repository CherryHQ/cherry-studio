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
   and resolves the tool's promise into a held state (Claude-Agent: holds
   `canUseTool`; MCP: stream pauses on the approval part).

2. **Stream pauses** — `AiStreamManager` transitions the topic to
   `awaiting-approval`. The `topic.stream.statuses.<topicId>` shared-cache
   entry carries the status; every renderer window reading that key sees
   the pause atomically.

3. **User decides** — the approval card renders from the part. On click,
   `useToolApprovalBridge` (`src/renderer/hooks/useToolApprovalBridge.ts`)
   calls `window.api.ai.toolApproval.respond(...)` with `approvalId`,
   `approved`, optional `reason` / `updatedInput`, `topicId`, `anchorId`.

4. **Main applies** — `AiService`'s `Ai_ToolApproval_Respond` handler
   branches on transport **before** touching the DB:
   - **Claude-Agent fast-path** (`AiService.ts:191-197`): hands the
     decision to `AgentSessionRuntimeService.respondToolApproval`, which
     resolves the live `canUseTool` promise so the existing stream
     proceeds. When a live registry entry handles it, the handler
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

`useToolApproval` (`src/renderer/pages/home/Messages/Tools/hooks/useToolApproval.ts`)
exposes an `autoApprove` action **only for MCP tools** — when an `mcpTool`
descriptor is passed. It persists the opt-out by PATCHing the server's
`disabledAutoApproveTools`, so the MCP settings page reflects it and
subsequent calls of that tool skip the approval card. There is no generic
per-tool default for non-MCP (e.g. Claude-Agent) tools.

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

- Main IPC handler: `src/main/ai/AiService.ts` (`Ai_ToolApproval_Respond`)
- Renderer bridge: `src/renderer/hooks/useToolApprovalBridge.ts`
- Persistent decisions: `src/renderer/pages/home/Messages/Tools/hooks/useToolApproval.ts`
- Status broadcast: [Stream Manager](./stream-manager.md)
