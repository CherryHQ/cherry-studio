# Agent Note: Subscription model offer on provider errors

Status: implemented

English | [中文](2026-11-19-subscription-model-error-switch.zh.md)

## Problem

A user with a paid Cherry AI subscription who chats with a model from another provider can hit that provider's key, quota, rate-limit, region, or outage errors. The chat error card only offered the provider's settings or a retry, although the subscription already includes models that would answer the same request.

## Decision

The Home chat adapter exposes `renderSubscriptionModelPicker` only while `useHasCurrentPaidPlan` is true. That hook requires fresh plans (`isPlansReady`) with an active paid entitlement (`activePaid`) whose recorded `expires_at`, if any, is still in the future. It re-checks at that expiry while mounted, so a card left open hides the entry when a non-renewing plan ends without a new receipt. The adapter reads the plans once per message list, and image-capture lists (`imageActionConsumer: 'capture'`) never get the action.

`ErrorBlock` shows a quiet "Use a subscription model" entry next to the detail link when all of these hold:

- The surface provides `renderSubscriptionModelPicker`. Agent, history, and other read-only surfaces do not.
- The failed message's provider is not `cherryai-subscription`.
- The message is not pending.
- The error category is one another provider's model can get past: `auth`, `permission`, `region`, `model`, `quota`, `rate_limit`, `server`, `deprecated`, or a local model-resolution failure.

The entry triggers the regenerate model picker, restricted to `cherryai-subscription` models and with offers disabled (`showSubscriptionOffers={false}`). A selection therefore always regenerates this reply; locked AMD, sign-in, and subscribe rows, which start their own flows, are not listed. The card's primary action (settings or retry) stays unchanged. The entry carries `data-image-capture-excluded`, which every image export omits, so a copied or saved message or topic image never reveals the exporting account's paid status.

## Alternatives considered

- Replace the primary action with the switch: rejected because fixing the original provider's key or quota remains a valid path, and the card has one primary action slot.
- Switch in one click to a fixed default subscription model: rejected because there is no product-owned default subscription chat model, and the user chooses the model elsewhere in chat.
- Offer the entry on every non-subscription error: rejected because request-shaped failures (context length, payload size, content policy) and local tool failures (MCP, knowledge, OCR) would recur on the subscription model.
- Show the entry when plans are stale or unknown: rejected because a lapsed subscription would get an entry whose models then fail.

## Consequences

- Error cards register no IPC listeners of their own. One plans subscription per message list serves every card.
- Surfaces without a subscription picker stay unchanged until their adapter supplies one.

## Verification

- AC1 — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: the entry sits beside the settings action, is marked for capture exclusion, and does not open the detail when clicked. It stays hidden for a subscription model, on a 413 payload error, and without the subscription picker. Mounting eligible and ineligible cards registers no IPC listener.
- AC2 — `src/renderer/hooks/cherryCloud/__tests__/useHasCurrentPaidPlan.test.ts` covers stale, unpaid, expired, and disabled plans, plus a plan that expires while mounted with no new receipt. `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx` shows the action is offered with a current paid plan, restricted to `cherryai-subscription`, and has offers off. It is withheld without a paid plan and in image-capture lists.
- AC3 — `src/renderer/components/cherryCloud/__tests__/CherryCloudModelSelector.test.tsx`: a signed-in picker with offers disabled omits a locked AMD chat model. `src/renderer/utils/__tests__/image.test.ts`: image capture filters out `data-image-capture-excluded` subtrees.
- AC4 — `pnpm check --base SiinXu/global-errors-7-tools --group checks` passes: format, docs, lint, `typecheck:web`, and the i18n catalog, unused, and hardcoded checks. The new key is translated in all 18 renderer locales.
- Electron, CN edition: a 401 card from an invalid OpenAI key shows no entry while signed out. Signing in failed in the dev build because `MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET` is not configured, so the subscribed path was not exercised in Electron. Packaged builds were not run.
