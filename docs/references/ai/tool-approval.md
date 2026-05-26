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
   `useToolApprovalBridge` (`src/renderer/src/hooks/useToolApprovalBridge.ts`)
   calls `window.api.ai.toolApproval.respond(...)` with `approvalId`,
   `approved`, optional `reason` / `updatedInput`, `topicId`, `anchorId`.

4. **Main applies** — `AiService` IPC handler:
   - Reads the anchor message's current `parts` from DB.
   - Calls `applyApprovalDecisions(beforeParts, [decision])`.
   - **Writes only when the target part is present on the DB row.** This
     guards the overlay-only case (approval received before the part has
     persisted) — for that case the continue-dispatch below carries the
     decision authoritatively.
   - When all approvals on the turn are decided, either:
     - **Claude-Agent**: resolves the live `canUseTool` promise via
       `toolApprovalRegistry`, the existing stream proceeds.
     - **MCP / other**: dispatches a synthetic
       `continue-conversation` request through `dispatchStreamRequest`;
       the provider applies the decision when it reads parts.

5. **Awaiting-approval clears** — the moment the continue stream
   broadcasts `pending`, the shared-cache entry flips back. Every window
   sees the approval card disappear in the same tick.

## Persistent decisions

`useToolApproval` (`src/renderer/src/pages/home/Messages/Tools/hooks/useToolApproval.ts`)
remembers per-(server, tool) and per-tool defaults so the user can
auto-approve the same call shape next time. MCP-tool decisions persist
into the same store the assistant's MCP server config lives in.

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
- Renderer bridge: `src/renderer/src/hooks/useToolApprovalBridge.ts`
- Persistent decisions: `src/renderer/src/pages/home/Messages/Tools/hooks/useToolApproval.ts`
- Status broadcast: [Stream Manager](./stream-manager.md)
