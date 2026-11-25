# Agent Note: Preserve queued Chat continuation paths

Status: implemented

English | [中文](2026-11-19-queued-chat-continuation.zh.md)

## Problem

Follow-ups queued during the same reply captured the same parent. Later sends could fork at that parent, hiding earlier queued turns and omitting them from model history. An accepted reply can also be deleted while the rest of its queue is paused.

## Decision

For ordinary Chat, an accepted queued send advances pending items that share its captured active-path anchor. The receipt identifies the reply selected at the SQLite write or assigned to an accepted Steer and written when its continuation starts. Matching items taken out for queue editing advance too. Explicitly reserved branches retain their own targets.

A queued send uses its chosen reply while that reply exists. Chat captures the original question with the first queued draft. If the reply has been deleted, both idle and live admission can continue from the same turn's surviving user question in the same topic. If that question is also unavailable, the draft remains queued for the existing failure handling.

## Alternatives considered

- Reading the topic's current active node would let a later branch selection redirect an already queued draft.
- Picking another model's reply after deletion would silently change the selected context. The question is the surviving point shared by the replies.

## Consequences

Consecutive queued turns preserve earlier context, including across a pause and an unrelated branch selection. Deleting the selected reply leaves any other reply intact. The pending send uses the surviving question and excludes the alternative reply from its request. Work submission behavior keeps its existing contract.

## Verification

- Regression — `PersistentChatContextProvider.test.ts` verifies request history and stored parent links after a branch switch or reply deletion, and a rejected write when both anchors are gone.
- Regression — `useFollowupQueue.test.ts` verifies that an accepted send updates a draft returned from editing and preserves a distinct reserved branch.
- Regression — `chatQueuedFollowupsContext.test.ts` exercises four sequential turns and a resumed queue after creating a separate branch in an isolated Electron instance with a loopback provider.
