# Agent Note: A tool-approval card outlived the request that could answer it

Status: implemented

English | [中文](2026-11-06-retire-abandoned-approval-cards.zh.md)

## Problem

When a runtime connection tears down while an approval is still pending, the emitter holder's dispose calls `toolApprovalRegistry.abort(sessionId, 'stream-ended')`. That resolves the waiting `canUseTool` promise with a denial and drops the registry entry, but a `message`-presentation approval — the kind `handleToolApprovalRequest` parks as its own `success` assistant row so a requesting agent can wait for the user past its parent turn — was left in the database exactly as it was: `approval-requested`.

The renderer reads that part as an open question, so the composer kept rendering the interaction card. Nothing on it could work: `AgentSessionRuntimeService.respondToolApproval` finds no registry entry and reports failure, and the `AiService` fallback behind it writes decisions onto the chat `message` table, where an agent-session row never exists. Submitting an answer and dismissing the card took the same path, so every attempt logged "Tool-approval response anchor is missing or deleted" in Main and "Tool approval response was not accepted" in the renderer while the card stayed on screen and kept the session unusable.

## Decision

`ToolApprovalRegistry` fires `onAborted` for every approval that `abort()` or `clear()` resolves without a user decision, carrying the session, tool call, presentation and reason. The registry stays in memory; listeners own the durable consequences. `AgentSessionRuntimeService` subscribes and retires `message`-presentation cards through a new `AgentSessionMessageService.retireAbandonedApproval(sessionId, approvalId, errorText)`, which locates the row holding that parked approval and terminalizes the part to `output-error` with a fixed reason. The row keeps its role and `success` status, because it is a settled interaction record rather than a live turn. `stream`-presentation approvals are not touched: their part never left the turn stream, whose own teardown already terminalizes it.

A click can still arrive for a card that outlived its request — one persisted before this fix, or one whose connection died while the user was answering. `AgentSessionRuntimeService.respondToolApproval` now records that decision on the card through the same `applyToolApprovalDecision` the live path uses, and still reports it as undelivered, so the card stops being offered without pretending the runtime received anything. `AiService` no longer routes an agent-session response into the chat-table lookup that could never match its anchor.

The renderer turns an undelivered answer into the session's next user message — each answered question, the chosen option, and any note typed beside it — instead of dropping it; a dismissal has nothing to re-deliver and simply refreshes. The conversation is then the only channel left once the asker is gone, and the answer reaches whoever continues the session. Main reports `reason: 'undelivered'` only when its transaction records the first decision on a pending or retired, unanswered card; stale or duplicate responses are rejected and never replayed. If sending the replacement message fails or admission is blocked, the renderer hands its text to the session's normal composer, appending to any existing draft for an explicit retry.

## Alternatives considered

- Only settle lazily when the click arrives, without retiring on abort: rejected because the card keeps looking answerable while nothing can reach its asker, and an ordinary permission card would still offer an approval whose tool can never run.
- Only retire on abort, without re-delivering the answer: rejected because a submitted answer would be dropped even though the session itself is still the natural place for it.
- Persist the card as `pending` or `paused` so an interruption pass terminalizes it: rejected because the row is deliberately settled so a parked subagent cannot block the session's next turn.
- Rely on the boot reconciliation of orphaned approvals: rejected because it no longer covers every native agent type, and it discards the session's resume token — the wrong treatment for a live teardown.
- Record the abort itself as a user denial: rejected because `attributeUserDenialReasons` would replay the host's reason to the model as the user's own words, which is why only the click path — where the decision really is the user's — records a denial.

## Consequences

A card whose requesting runtime went away is terminalized with a fixed reason, so it never blocks the session, and a click that still arrives on such a card is no longer a dead end: the card records the user's decision and its content becomes the session's next message. Answers the runtime never saw are therefore visible in the transcript rather than silently lost.

A draft typed into a card in the instant its connection dies is discarded together with the draft cache, and a hard kill still depends on the boot path, which does not retire parked cards for every agent type.

## Verification

- Regression — `pnpm exec vitest run --project main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/__tests__/AiService.test.ts src/main/data/services/__tests__/AgentSessionMessageService.test.ts src/main/ipc/handlers/__tests__/ai.test.ts src/main/ai/messages/__tests__/attachmentWorkerClient.test.ts`: 458 tests pass, including first-decision replay admission and a late answer recorded exactly once on a retired card. The latter failed before the correction because the retired card rejected its first answer.
- Regression — `pnpm test:renderer src/renderer/pages/agents/__tests__/useAgentChatRuntimeState.test.tsx src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx src/renderer/components/composer/variants/__tests__/AskUserQuestionComposer.test.tsx`: 240 tests pass. The new duplicate-response and failed-send draft cases failed before the correction; existing composer tests verify handed-over text appends to the current draft.
- Regression — Reproduced on the shipped 2.1.10 build: after `Aborted pending approvals … reason "stream-ended"` for session `3fb71b0d`, the card kept its `approval-requested` part and 28 answering attempts were refused with `Tool-approval response anchor is missing or deleted`.
