# Agent Note: Cherry Cloud quota display consistency

Status: implemented

English | [中文](2026-11-16-cherry-cloud-quota-display.zh.md)

## Problem

The subscription card's percentage came from `(limit_units - used_units) / limit_units` in `src/renderer/utils/cherryCloudQuota.ts`, fed by the `plans` fact. `refreshAccount` in `src/main/services/cherryCloud/CherryCloudService.ts` refreshed that fact only for the `initial` and `focus_refresh` reasons, while the card's hook in `src/renderer/hooks/useCherryCloudPlans.ts` disables focus revalidation.

The composer banner and send gate used a different fact: `receipt.models`, polled every 60 seconds by `src/renderer/hooks/useCherryCloudModelAvailability.ts`. `projectEntitledModels` in the same service decided availability per quota pool from `windows[].remaining_units` plus a refusal floor written by a real refusal.

A trusted `429 QUOTA_EXHAUSTED` cleared the model-sync cache but never refetched the account or plans, so the card could not react without an app restart. Issue #24649 showed the resulting contradiction: the card displayed "100.00% remaining" while the composer blocked sending and the API returned 429 for the same monthly window.

## Decision

`remaining_units` is the authoritative availability figure. The card derives its percentage from it, clamped and floored to two decimals, never from `limit_units - used_units`.

The card joins the fresh `models` decision per quota pool, using the same `quotaExhaustedModelIds` set as the composer gate. A pool whose models the server has refused renders exhausted, and its windows render 0. If its stored statistics still claim quota remains, the card additionally says the statistics are out of date instead of printing a positive percentage.

A trusted refusal is HTTP 429 with `Cherry-Error-Code: QUOTA_EXHAUSTED` on a model inference request, both on the first response and after an auth/replay retry. It marks the retained `plans` fact stale, publishes the receipt, and admits at most one full account refresh per 30-second window. The refusal response itself is returned untouched; the user's request is never replayed, and returning the refusal never awaits the refresh.

The composer gate and the 60-second availability poll are unchanged. The composer still blocks sending on exhaustion.

## Alternatives considered

- Publish a receipt-level quota fact from the main process: rejected as schema churn that duplicates the decision already carried by `models.quotaExhaustedModelIds`.
- Derive exhaustion from `used_units === limit_units`: rejected because reserved units make it wrong in both directions.
- Remove the composer gate: rejected because the requester wants to be told before typing; the defect was the contradiction, not the gate.
- Add a polling timer for the card: rejected because the existing 60-second availability poll already re-derives the decision, and one refusal-triggered refresh covers the missing transition.

## Consequences

A trusted refusal now flips the retained `plans` fact to stale until the admitted refresh completes. The usage block therefore renders its retained snapshot with the out-of-date marker and a retry affordance instead of the load-failure text. Purchase and analytics paths that require a fresh `plans` fact keep their existing freshness condition.

The card can no longer display a percentage that contradicts the block. A contradictory snapshot is labelled rather than silently overwritten.

The new translation key `settings.subscription.quota_out_of_date` had to be added to all 17 locales, with real translations.

## Verification

- AC1 — A window whose `remaining_units` is 0 renders 0.00 % and one that has 5 of 20 left renders 25.00 % (verification: unit)
- AC2 — A pool named by a fresh `quotaExhaustedModelIds` set renders exhausted with 0 for its windows, and contradictory statistics render the out-of-date line (verification: renderer)
- AC3 — A trusted 429 returns the refusal untouched and admits exactly one plans refresh, while a second refusal inside 30 s admits none and one after the cooldown admits another (verification: unit)
- AC4 — An untagged 429, a `RATE_LIMITED` refusal, a plain-text quota message and a 403 with the same code admit no refresh (verification: unit)
- AC5 — A trusted refusal that arrives after signing out admits no refresh and leaves the receipt signed-out (verification: unit)
- Regression — src/renderer/utils/__tests__/cherryCloudQuota.test.ts covers the percentage table, the pool join, provider filtering, non-active entitlements, stale facts and the summary minimum (verification: unit)
- Regression — src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts covers the refusal refresh, its cooldown, untrusted refusals, the post-retry path, the signed-out race and the no-recursion case (verification: unit)
