---
description: Conversation-owned tool interactions, Main-authoritative decisions, and Chat versus Agent resume modes
sources:
  - src/main/ai/AiService.ts
  - src/main/ai/conversation/ConversationRuntimeService.ts
  - src/main/ai/agentSession/AgentConnectionManager.ts
  - src/main/ipc/handlers/ai.ts
  - src/renderer/hooks/useToolApprovalBridge.ts
---

# Tool Approval

## Model

Main is the single writer of approval decisions. The Conversation aggregate
owns the interaction lifecycle; the concrete execution driver decides whether
resolution resumes in place or starts a new resource run.

| Driver | Interaction resume |
|---|---|
| Stateful Agent | `InPlace`: resolve the registered approval promise on the existing connection |
| Stateless MCP Chat | `NewRun`: persist the decision, then launch the exact waiting execution again |

The Renderer displays the interaction and submits a decision. It never patches
message parts directly.

## End-to-end flow

1. A driver emits `tool-approval-request`. `AiExecutionManager` reports
   `InteractionOpened` with exact Conversation, Turn, Execution, and approval
   identity.
2. The aggregate moves that execution to `WaitingInteraction`. Its terminal
   snapshot is persisted before Main publishes
   `ConversationStatus.AwaitingInteraction` and the exact
   `awaitingInteractionExecutions` projection.
3. `useToolApprovalBridge` sends `ai.tool.respond_approval` with approval ID,
   decision, optional reason/input, exact `ConversationRef`, and durable anchor
   when Chat persistence requires it.
4. `AiService.respondToolApproval` selects the driver boundary:
   - Agent registry hit: `AgentConnectionManager` resolves the live registry
     entry and returns without reading Chat message storage.
   - Chat fallback: Main atomically applies the decision to the exact anchor
     row. Multiple approvals on one row cannot clobber one another.
5. When other approvals remain open, only that interaction is resolved. When
   the row has no pending approvals,
   `ConversationRuntimeService.respondChatToolApproval` validates the exact
   waiting execution, commits the continuation skeleton, and replaces that
   execution's resource run inside the same logical Turn.
6. Stop interrupts the same Conversation actor. A late approval or continuation
   result is stale and cannot reopen a stopped or newer Turn.

## Overlay and persistence gap

The approval card can appear from a live chunk before its row is durable. Main
therefore owns both the conditional row mutation and continuation admission. A
missing or deleted anchor returns `{ ok: false }`; a duplicate already-settled
decision is idempotent. A concurrent live submit cannot swallow a continuation:
the Conversation lane rejects the stale transition.

## Persistent MCP decisions

`useToolApproval` exposes `autoApprove` only for MCP tools. It updates the MCP
server's `disabledAutoApproveTools`; this preference is independent from the
per-Turn Conversation interaction.

## Invariants

- Interaction state is aggregate state, not a message-parts scan or shared-cache
  decision.
- Decision writes happen only in Main.
- Agent and Chat share one interaction protocol but keep driver-specific resume
  mechanics.
- Normal waiting and resumed terminal projections publish only after durable
  persistence.
- Exact identity prevents an old approval from resuming the current Turn.
