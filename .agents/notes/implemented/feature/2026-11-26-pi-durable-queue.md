# Agent Note: Pi Durable follow-up queue in the composer

Status: implemented

English | [中文](2026-11-26-pi-durable-queue.zh.md)

## Problem

Busy Pi Durable sessions persist follow-ups in the native inbox. Users need to see and change inputs while they are waiting. The Work composer also needs to forward the Queue intent through stream admission so Pi Durable can distinguish that input from a steer.

## Decision

The Work composer submits follow-ups immediately and shows the ordered native inbox in its queue panel. Inbox changes and restored roots publish the current waiting items. Placement and withdrawal remove items from the panel. Queue and Steer use their existing send controls.

The desktop saves the complete input before native submission. The input stays off the conversation branch while it waits. Native placement adds it to the branch and reserves its reply in one transaction. An input interrupted before placement can appear as an unsent message.

A natural turn completion drains the running queue. User Stop pauses the inbox in the commit that records stop and marks the active run for cancellation. Waiting follow-ups retain their order, content and IDs across restart. They remain editable, reorderable and withdrawable. Resume releases the original queue. An explicit new send while idle can run with older follow-ups still paused.

Insert message changes a waiting follow-up to a steer in the native inbox transaction. The submission keeps its ID and content. The message moves to the conversation with a waiting indicator until native placement. A steer taken during the original run shares its reply. If the run ends first, the next run owns the reply. Recovery uses the original submission and its recorded run to make the same choice.

Admission registers the request ID in the same native transaction as the submission. Durable startup recovery reads these IDs from the original backend and applies its persisted submissions in placement order. The desktop acknowledges each ID after it commits the conversation update. A crash before acknowledgement can replay the same product input and reply. Opening an owning session checks saved inputs that have no native receipt, including inputs saved by older builds.

Edit and reorder use a native transaction with stale-input checks. The amended text and its product text part follow the same submission through placement. The desktop applies the text part by the original message ID during live projection and recovery. Embedded reference prompts move onto separate lines after the edited body. Attachments and other message parts stay attached. A drag uses the order captured when it started. Remove settles one waiting submission as `withdrawn` in the same transaction that removes it from the inbox. The desktop deletes its staged input using the recorded outcome. Recovery can finish deletion after a crash between the two writes. The [Pi Durable turn contract](../architecture/2026-11-18-pi-durable-turn-authority.md) governs reply ownership and recovery.

## Alternatives considered

A renderer-owned queue would delay native admission and make waiting messages vulnerable to renderer or app exit. Canceling and resubmitting would change native submission IDs and could interleave with placement.

## Consequences

Pi Durable follow-ups remain editable and reorderable until placement. Pending order and edits survive a restart. Remove discards the waiting input without adding it to the conversation. Pi and Claude Code retain their existing composer queue behavior.

## Verification

- AC1 — Electron with a held local provider request showed three native follow-ups. After restarting Electron, the panel showed the two remaining messages in the saved order before the active request was released.
- AC2 — `agentSessionFollowups.test.ts` checks that Unicode and complete words survive edits with an embedded link. `followups.test.ts` checks persistent native IDs and edited model input. Electron confirmed that editing kept the product message ID and that the edited text reached both persisted history and the model after restart.
- AC3 — `NativeQueuedFollowups.test.tsx` checks a queue change during a drag and a successful retry. `followups.test.ts` checks stale edits and reorder requests. Electron dragged the second input above the first, observed the new provider request order, and verified that a late edit was rejected.
- AC4 — `followups.test.ts` verifies explicit withdrawal of a waiting native submission. `PiDurableRuntimeConnection.test.ts` covers replay before and after the desktop discards the draft. Electron verifies that Remove leaves the message out of the transcript and out of model requests after restart.
- AC5 — `useAgentChatRuntimeState.test.tsx` checks Queue and Steer at stream admission. `AgentComposer.test.tsx`, `QueuedFollowupsDock.test.tsx`, and `useFollowupQueue.test.ts` cover the existing composer queue controls.
- AC6 — `followups.test.ts` reopens a native stop and preserves the original queued submission. `piDurableTurnAuthority.test.ts` verifies that Stop leaves two follow-ups queued across restart, a new send runs while they wait, and Resume places each once with its own persisted reply.
- Regression — `AgentSessionSubmission.test.ts` covers delayed branch publication, duplicate placement, and unsent recovery. `piDurableTurnAuthority.test.ts` checks that an input is absent from the conversation while it waits and appears once when Durable takes it. The real Electron crash test also checks that the queued input stays in the inbox through a forced Main exit and receives a single reply after restart. `PiDurableRuntimeConnection.test.ts` replays a placement after the product write committed without acknowledging the native request.
