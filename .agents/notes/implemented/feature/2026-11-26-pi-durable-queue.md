# Agent Note: Pi Durable follow-up queue in the composer

Status: implemented

English | [中文](2026-11-26-pi-durable-queue.zh.md)

## Problem

Busy Pi Durable sessions persist follow-ups in the native inbox. Users need to see and change inputs while they are waiting. The Work composer also needs to forward the Queue intent through stream admission so Pi Durable can distinguish that input from a steer.

## Decision

The Work composer submits follow-ups immediately and shows the ordered native inbox in its queue panel. Inbox changes and restored roots publish the current waiting items. Placement and withdrawal remove items from the panel. Queue and Steer use their existing send controls.

Edit and reorder use a native transaction with stale-input checks. The amended text and its product text part follow the same submission through placement. The desktop applies the text part by the original message ID during live projection and recovery. Embedded reference prompts move onto separate lines after the edited body. Attachments and other message parts stay attached. A drag uses the order captured when it started. Withdrawal aborts one native submission, and startup can restore its unsent status by the saved request ID. The [Pi Durable turn contract](../architecture/2026-11-18-pi-durable-turn-authority.md) governs reply ownership and recovery.

## Alternatives considered

A renderer-owned queue would delay native admission and make waiting messages vulnerable to renderer or app exit. Canceling and resubmitting would change native submission IDs and could interleave with placement.

## Consequences

Pi Durable follow-ups remain editable and reorderable until placement. Pending order and edits survive a restart. A withdrawn input can be restored through the existing unsent-message controls. Pi and Claude Code retain their existing composer queue behavior.

## Verification

- AC1 — Electron with a held local provider request showed three native follow-ups. After restarting Electron, the panel showed the two remaining messages in the saved order before the active request was released.
- AC2 — `agentSessionFollowups.test.ts` checks that Unicode and complete words survive edits with an embedded link. `followups.test.ts` checks persistent native IDs and edited model input. Electron confirmed that editing kept the product message ID and that the edited text reached both persisted history and the model after restart.
- AC3 — `NativeQueuedFollowups.test.tsx` checks a queue change during a drag and a successful retry. `followups.test.ts` checks stale edits and reorder requests. Electron dragged the second input above the first, observed the new provider request order, and verified that a late edit was rejected.
- AC4 — `PiDurableRuntimeConnection.test.ts` recovers the unsent message when only the native withdrawal committed before reopen. `followups.test.ts` checks single-submission withdrawal. Electron withdrew one pending input, kept the active request open, and verified that the withdrawn text never reached the provider.
- AC5 — `useAgentChatRuntimeState.test.tsx` checks Queue and Steer at stream admission. `AgentComposer.test.tsx`, `QueuedFollowupsDock.test.tsx`, and `useFollowupQueue.test.ts` cover the existing composer queue controls.
