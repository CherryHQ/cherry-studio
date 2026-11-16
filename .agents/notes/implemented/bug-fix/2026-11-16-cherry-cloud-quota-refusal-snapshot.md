# Agent Note: Cherry Cloud quota refusals defer to the account snapshot

Status: implemented

English | [中文](2026-11-16-cherry-cloud-quota-refusal-snapshot.zh.md)

## Problem

The Cloud gateway reserves the estimated input cost plus `max_tokens` × output price before it serves a request. It returns `429 QUOTA_EXHAUSTED` when that reservation, added to used units and other in-flight reservations, exceeds any window. A large Agent request can therefore be refused while the pool still reports units left, and the next request can succeed a second later.

`CherryCloudService` recorded each refused model and kept its pool marked exhausted until some window's `remaining_units` grew above the value seen at refusal. One refusal locked the model in the selector and composer for the rest of the window. Every Cloud quota refusal was also titled "Plan quota exhausted", even with most of the plan left.

## Decision

[`CherryCloudService`](../../../../src/main/services/cherryCloud/CherryCloudService.ts) keeps no refusal state. A pool is exhausted only while the latest account snapshot reports a window at zero units. When a message request receives `429 QUOTA_EXHAUSTED`, either first or after an auth or replay retry, the service runs a full account refresh (account, models, plans) with reason `quota_refusal` and returns the response once it settles. Concurrent refusals in the same account scope share one refresh, which is bounded to five seconds. A refresh that does not complete is logged and the original 429 is still returned; a caller that aborts stops waiting and receives the abort instead.

The renderer picks the refusal title from that snapshot. The [error block](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx) and the [conversation toast](../../../../src/renderer/hooks/useConversationErrorToasts.ts) say the quota is exhausted only when the snapshot lists the model as exhausted. Otherwise, including when the snapshot is stale or not yet loaded, they say this request needs more quota than is available and suggest a shorter context or waiting for in-progress requests. A toast retry that fails again does not reuse the original failure's snapshot fact.

This partially supersedes the "quota-refusal floors" preservation in the [Cherry Cloud ownership Spec](../../proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md).

## Alternatives considered

- Keep the floors and only refresh sooner: rejected because the floor still locks a pool whose units are unchanged after an in-flight reservation is released.
- Stamp exhausted/insufficient into the serialized error at refusal time: rejected for now because it threads a Cloud-specific fact through the shared error serialization and Claude Code replay paths. As a result, historical error messages follow the current snapshot.
- Infer the cause from the server's retry delay or message text: rejected because the gateway does not expose that as a contract.
- Refresh in the background without waiting, as [#24660](https://github.com/CherryHQ/cherry-studio/pull/24660) proposes: rejected because the error title would then read the pre-refusal snapshot.

## Consequences

A refused model stays selectable while its pool has units, and the composer quota notice appears only for a real zero. A refusal is delayed by up to one account refresh before it reaches the conversation. The gateway still reports both causes with the same code; separating them belongs to the backend.

## Verification

- Regression — `pnpm test:main src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`: the `quota refusals` cases cover a refusal with units left, a real zero that releases when units return, concurrent refusals sharing one refresh, a refusal on the replayed request, an abort during the wait, no refresh outside model requests, and a failed refresh that still returns the 429. Five of them fail against the previous service. The five-second bound is not unit-tested because `AbortSignal.timeout` does not follow fake timers.
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/services/__tests__/toast.test.ts src/renderer/hooks/__tests__/useConversationErrorToasts.test.ts`: refusal titles follow the snapshot loaded through the IPC boundary, and a retried toast drops the original fact.
