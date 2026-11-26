# Agent Note: Cherry Cloud quota refusals defer to the server

Status: implemented

English | [中文](2026-11-16-cherry-cloud-quota-refusal-snapshot.zh.md)

## Problem

The Cloud gateway reserves the estimated input cost plus a per-request charge before it serves a request; `max_tokens` is not reserved. It returns `429 QUOTA_EXHAUSTED` when that reservation, added to used units and other in-flight reservations, exceeds any window. A request can therefore be refused while the pool still has units left, and the next request can succeed a second later. The same code covers a used-up window; the gateway tells the two apart only through `Retry-After` and its message, which names the suggested wait.

`CherryCloudService` recorded each refused model and kept its pool marked exhausted until some window's `remaining_units` grew above the value seen at refusal. One refusal locked the model in the selector and composer for the rest of the window. Every Cloud quota refusal was also titled "Plan quota exhausted", even with most of the plan left.

## Decision

The client no longer infers why a request was refused.

- [`CherryCloudService`](../../../../src/main/services/cherryCloud/CherryCloudService.ts) keeps no refusal state. A pool is exhausted only while a window's settled usage reaches its limit (`used_units >= limit_units`). `remaining_units` is not used because it also subtracts in-flight reservations, which free up within seconds.
- When a model request (`/v1/messages` or `/v1/chat/completions`) receives `429 QUOTA_EXHAUSTED`, either first or after an auth or replay retry, the service returns the refusal at once and starts a background account refresh (account, models, plans) with reason `quota_refusal`. Concurrent refusals in one account scope share that refresh; a refresh that does not complete is logged.
- The [error block](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx) and the [toast](../../../../src/renderer/services/toast.ts) title a Cloud quota refusal "Not enough plan quota for this request" only when the body carries the gateway's own `QUOTA_EXHAUSTED` code, and show the server's message, which carries the gateway's own retry estimate. The composer's recovery time uses the same settled-usage rule.
- Every other Cloud quota refusal, and every Cloud rate-limit error that carries server text, gets the neutral title "This request is temporarily limited". This includes AMD free-model limits, which reach the client without Cloud's `QUOTA_EXHAUSTED` code (see the [AMD free-models Spec](../../proposed/feature/2026-11-10-amd-free-models.md)). Any server text sits under it unclamped and without the generic HTTP 429 sentence, and the error offers no settings or billing shortcut. AMD's wording may itself say "quota", so the shared provider-error serialization keeps the body's `code` as `providerErrorCode`; the body itself is dropped.

This partially supersedes the "quota-refusal floors" preservation in the [Cherry Cloud ownership Spec](../../proposed/architecture/2026-11-08-cherry-cloud-ownership-convergence.md).

## Alternatives considered

- Keep the floors and only refresh sooner: rejected because the floor still locks a pool whose units are unchanged after an in-flight reservation is released.
- Lock on `remaining_units == 0` and choose between "exhausted" and "insufficient for this request" titles from the refreshed snapshot: rejected because a burst of in-flight reservations reads as zero, which locked a model that would serve again within seconds and needed the refusal to wait for the refresh.
- Choose the title from `Retry-After`: not needed, because the server message already states the wait; carrying the header would thread a Cloud-only fact through the shared error serialization.
- Infer the cause from message text: rejected because message text is not a contract.
- Tell AMD models apart by catalog membership: rejected because the toast gets no model id, and the error block and toast must agree on the title.

## Consequences

A refused model stays selectable until a window's settled usage is used up, and refusals reach the conversation without delay. The title no longer says whether the plan is used up or only this request does not fit; the server message under it does. A pool with a few units left still refuses large requests while staying selectable, and each refusal shows the server's suggested wait.

A plan refusal reported by Claude Code reaches the client as text only (`API Error: Request rejected (429) · …`), so it shows the neutral title over the plan text instead of the plan title.

## Verification

- Regression — `pnpm test:main src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`: the `quota refusals` cases cover a refusal returned before the refresh completes, a refused model that stays usable while in-flight reservations take the rest of the pool, a lock only at a settled limit that releases when usage resets, concurrent refusals sharing one refresh, a refusal on the replayed request, and no refresh outside model requests. Five fail against the service before this fix.
- Regression — `pnpm test:renderer src/renderer/hooks/__tests__/useCherryCloudQuotaExhaustion.test.tsx`: a window that reads zero only because of in-flight reservations does not delay the recovery time.
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/services/__tests__/toast.test.ts`: AMD per-minute, daily-quota and busy 429s keep their full server text under the neutral title, a text-only Claude Code plan refusal shows its plan text under the neutral title, a quota-worded AMD refusal never gets the plan title, a generic Cloud rate-limit toast is titled neutrally and keeps its retry action, and a textless Cloud quota refusal gets neither the plan title nor a billing or settings shortcut. Seven cases fail against the previous presentation.
- Regression — `pnpm test:shared src/shared/ai/__tests__/providerError.test.ts`: the body code survives serialization of an API error and of each retry attempt.
