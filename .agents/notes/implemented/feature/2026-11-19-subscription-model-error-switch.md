# Agent Note: Subscription model offer on provider errors

Status: implemented

English | [中文](2026-11-19-subscription-model-error-switch.zh.md)

## Problem

A user with a paid Cherry AI subscription who chats with a model from another provider can hit that provider's key, quota, rate-limit, region, or outage errors. The chat error card only offered the provider's settings or a retry, although the subscription already includes models that would answer the same request.

## Decision

`ErrorBlock` adds a quiet "Use a subscription model" entry next to the detail link when all of these hold:

- The surface provides `renderRegenerateModelPicker`. Today that is the Home chat adapter; agent, history, and other read-only surfaces show no entry.
- The failed message's provider is not `cherryai-subscription`.
- The message is not pending.
- The error category is one another provider's model can get past: `auth`, `permission`, `region`, `model`, `quota`, `rate_limit`, `server`, `deprecated`, or a local model-resolution failure.
- `useCherryCloudPlans` reports fresh plans (`isPlansReady`) with an active paid entitlement (`activePaid`).

The entry is the trigger of the existing regenerate model picker. `MessageModelPickerRenderOptions.providerId` limits that picker to `cherryai-subscription`, so a selection regenerates this reply with the chosen subscription model. The card's primary action (settings or retry) stays unchanged.

## Alternatives considered

- Replace the primary action with the switch: rejected because fixing the original provider's key or quota remains a valid path, and the card has one primary action slot.
- Switch in one click to a fixed default subscription model: rejected because there is no product-owned default subscription chat model, and the user chooses the model elsewhere in chat.
- Offer the entry on every non-subscription error: rejected because request-shaped failures (context length, payload size, content policy) and local tool failures (MCP, knowledge, OCR) would recur on the subscription model.
- Show the entry when plans are stale or unknown: rejected because a lapsed subscription would get an entry whose models then fail.

## Consequences

- The plan lookup runs only for cards that already qualify on surface, provider, and category. It shares the SWR caches that the main window's subscription reminder warms.
- Surfaces without the regenerate picker stay unchanged until their adapter supplies one.

## Verification

- AC1 — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: a subscriber's rate-limited OpenAI reply offers a picker limited to `cherryai-subscription` whose click does not open the error detail; the entry stays hidden without a paid plan, with unconfirmed plans, for a subscription model, on a 413 payload error, and on a surface without the picker.
- AC2 — `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx`: a `providerId` option makes the picker filter reject other providers' models.
- AC3 — `pnpm check --base SiinXu/global-errors-7-tools --group checks` passes: format, docs, lint, `typecheck:web`, and the i18n catalog, unused, and hardcoded checks. The new key is translated in all 18 renderer locales.
- Electron and packaged-build checks were not run.
