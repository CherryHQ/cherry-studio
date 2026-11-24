# Agent Note: Subscription model offer on provider errors

Status: implemented

English | [中文](2026-11-19-subscription-model-error-switch.zh.md)

## Problem

A user with a paid Cherry AI subscription who chats with a model from another provider can hit that provider's key, quota, rate-limit, region, or outage errors. The error only offered the provider's settings or a retry, although the subscription already includes models that would answer the same request. This happens in Home chat and in agent sessions alike.

## Decision

A recommendation strip sits above the composer input, in the same slot and visual language as the Cherry Cloud quota notice, in both Home chat (`ChatComposer`) and agent sessions (`AgentComposer`). `shouldSuggestSubscriptionModel` in `src/renderer/components/composer/subscriptionModelSuggestion.ts` decides from the conversation's latest message. It qualifies when all of these hold:

- The latest message is an assistant reply with status `error` and a `data-error` part. Home reads its live parts first.
- The reply's provider is not `cherryai-subscription`. The provider comes from the frozen author snapshot, then the row's model id, then the error itself.
- The error category is one another provider's model can get past: `auth`, `permission`, `region`, `model`, `quota`, `rate_limit`, `server`, `deprecated`, or a local model-resolution failure.

Home computes this in `ChatContentInner` from the runtime messages and passes one `suggestSubscriptionModel` prop through `ChatComposerSlot` and `ChatPlacementComposer`. It is suppressed while the topic history is stale. `AgentComposer` computes it from its `messages` prop when the session allows model changes.

`SubscriptionModelNotice` renders only while `useHasCurrentPaidPlan` is true, and calls that hook only while a qualifying failure exists. The hook requires fresh plans with an active paid entitlement whose recorded expiry, if any, is still in the future. The strip hides once the composer's current model is already a subscription model. Its button mounts `CherryCloudModelSelector` on the first click. The picker lists only `cherryai-subscription` models that also pass the composer's own model constraints (chat models for Home, the agent runtime filter plus agent-only models for agents). Offers are off (`showSubscriptionOffers={false}`), so locked AMD, sign-in, and subscribe rows are not listed. Choosing a model switches the current conversation's model through the composer's own selection path: Home's model selector handler ends in `setModel`, and agents call `updateSession({ id, model })`. It does not regenerate the failed reply.

The chat error card has no subscription entry.

## Alternatives considered

- An entry on the chat error card that regenerates the reply with a subscription model: rejected because it only covered Home chat, and it needed per-card plan reads, click-capture guards, and image-capture exclusion that review kept flagging.
- Regenerate the failed reply instead of switching the model: rejected by product choice. The user wants the conversation to continue on the subscription model.
- Switch in one click to a fixed default subscription model: rejected because there is no product-owned default subscription chat model, and the user chooses the model elsewhere in chat.
- Offer the switch on every non-subscription error: rejected because request-shaped failures (context length, payload size, content policy) and local tool failures (MCP, knowledge, OCR) would recur on the subscription model.
- Show the strip when plans are stale or unknown: rejected because a lapsed subscription would get a strip whose models then fail.

## Consequences

- The strip follows the latest reply only. Once the user sends again or the model switches to a subscription model, it disappears.
- Plans are read only while a qualifying failure exists, and model data loads only after the first click.
- The subscribed path has not been exercised in Electron for this layer. Packaged builds were not run.

## Verification

- AC1 — `src/renderer/components/composer/__tests__/subscriptionModelSuggestion.test.ts`: auth, permission, model, rate-limit, server, and local model-resolution failures from another provider qualify, including a provider read from the snapshot or the error. A subscription-provider failure, context-length and network failures, a non-error status, an earlier failure followed by a newer message, and a missing error part do not. Live parts take precedence over persisted parts.
- AC2 — `src/renderer/components/composer/__tests__/SubscriptionModelNotice.test.tsx`: with the real selector, a paid subscriber's picker lists only subscription models the composer filter accepts, without the locked AMD row, and choosing one calls the select handler with it. The strip stays hidden without a paid plan, with stale plans, without a qualifying failure, and when the current model is already a subscription model.
- AC3 — `src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx` and `AgentComposer.test.tsx`: picking from the strip calls `setModel` for Home chat and `updateSession` with the session model for agents. `src/renderer/pages/home/__tests__/ChatContent.test.tsx`: a failed latest reply reaches the Home composer through `ChatComposerSlot`, and stale history withholds it.
- AC4 — `src/renderer/hooks/cherryCloud/__tests__/useHasCurrentPaidPlan.test.ts` covers stale, unpaid, expired, and disabled plans, a plan that expires while mounted, and a deadline that passes between render and effect. `src/renderer/components/cherryCloud/__tests__/CherryCloudModelSelector.test.tsx`: a signed-in picker with offers disabled omits a locked AMD chat model.
- AC5 — `tsrs --noEmit -p tsconfig.web.json`, `oxlint --deny-warnings`, `eslint`, and `oxfmt` on the changed files, `pnpm i18n:check`, and `pnpm docs:check` pass. The new keys are translated in all 18 renderer locales.
