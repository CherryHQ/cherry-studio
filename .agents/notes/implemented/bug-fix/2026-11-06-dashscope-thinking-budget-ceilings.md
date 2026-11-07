# Agent Note: DashScope thinking-budget ceilings and degrade retry

Status: implemented

English | [中文](2026-11-06-dashscope-thinking-budget-ceilings.zh.md)

## Problem

Chat turns against Bailian/QwenCloud Qwen3.5/Qwen3.6 SKUs fail outright with `400 InternalError.Algo.InvalidParameter: The thinking_budget parameter must be a positive integer and not greater than {81920 | 131072 | 0}`. The client derives `thinking_budget` only from the model descriptor's `thinkingTokenLimits` with no provider-side ceiling, sends the parameter even to SKUs that accept none (`qwen3.5-ocr`), never retries in place, and relays only the provider's raw parameter text with no hint about the reasoning setting involved.

## Decision

- The wire budget policy gains an optional `max`; `qwenChatWire` caps at 81920, the new `qwenChatWire128k` at 131072, and `qwenChatWire262k` at 262144 for qwen3.7 plus/max/flash (descriptor + docs, #23688), mapped per SKU (including dated snapshots via the shared `isQwen128kChatModel` / `isQwen262kChatModel` prefix matchers) on both `dashscope` and `qwencloud`. `resolveModeBudget` clamps to `min(policy.max, thinkingTokenLimits.max)`.
- Alibaba reasoning families declare the qwen3.6-plus/flash/max-preview budget as 131072, and OCR SKUs (`-ocr(?:-|$)`) are excluded from vocabulary, membership, and budget rules, so they resolve no reasoning descriptor at all.
- An ai-retry degrade entry (first in the chain) retries the same model once: clamp every `thinking_budget` leaf to the reported ceiling, or omit the budget while keeping `enable_thinking` when the ceiling is 0. Unparseable ceilings, already-compliant budgets, and budget-less attempts do not retry. The entry returns `maxAttempts: sameModelAttempts + 1` so the corrected call is sent even though ai-retry counts the failed original against the default limit of 1, including after earlier attempts. The entry is retry-gated, so no extra billed call is made when retries are disabled.
- Fireworks presets keep their qualified account-scoped wire IDs (`accounts/fireworks/models|routers/...`) as explicit overrides with pinned pricing, so upstream `models.dev` renames cannot silently fall back to canonical slugs (#23688).
- LongCat 2.5/2.0 hand-list their toggle controls in the creator so upstream effort tiers cannot replace the documented none/auto contract on Chat/Anthropic wires (#23688).
- Serialized chat errors and API-gateway error envelopes append an actionable hint naming the reasoning setting, including for `RetryError`-wrapped rejections whose surfaced message is generic.

## Alternatives considered

- Per-model `support` overrides instead of a wire `max`: same effect with a wider surface, and no backstop for descriptors that are missing or wider than Bailian accepts.
- Always stripping the budget on any rejection: would silently disable thinking on unparseable rejections; rejected in favor of clamp-first, strip-only-on-zero.
- Running the degrade independently of the retry toggle: rejected, cost-control users with retries disabled must not receive an extra billed call.

## Consequences

- Descriptor-derived budgets can no longer exceed the SKU ceiling; custom or override-supplied budgets that still fail get exactly one degrade retry, otherwise an actionable error.
- Stale persisted OCR model rows keep their old descriptor until re-resolved; they are covered by the degrade retry and the hint.
- The catalog carries only the intended wire-ceiling rows; same-day upstream drift in unrelated families is reverted, not committed, so membership/catalog invariants stay green. Fireworks wire IDs and LongCat toggles are pinned in source and survive upstream renames.
- The provider-registry change ships with a patch changeset.

## Verification

- Regression — `src/shared/ai/__tests__/thinkingBudget.test.ts`: matcher, ceiling parser, clamp/strip transforms, hint.
- Regression — `src/main/ai/runtime/aiSdk/retry/__tests__/thinkingBudgetDegrade.test.ts`: clamp retry, zero-ceiling omit, unparseable/no-op/budget-less guards, `maxAttempts` for the corrected call including after earlier attempts.
- Regression — `src/main/ai/runtime/aiSdk/retry/__tests__/createRetryableWrap.test.ts`: wrapper sends the clamped second call in place.
- Regression — `src/main/ai/utils/__tests__/reasoningSerializers.test.ts`: wider-descriptor clamp, tighter-descriptor keep.
- Regression — `src/main/ai/utils/__tests__/serializeError.test.ts` and `src/main/features/apiGateway/__tests__/errors.http.test.ts`: hint on direct and `RetryError`-wrapped rejections.
- Regression — `packages/provider-registry/src/__tests__/provider-reasoning-contracts.test.ts`: per-SKU 262K/128K/81920 wire ceilings, snapshot prefix matchers, Fireworks wire-ID preservation; `reasoningMembership.test.ts`: OCR exclusion; `longcat-catalog.test.ts` / `catalog-invariants.test.ts`: toggle and account-scoped wire IDs.
- Regression — `pnpm typecheck:node`, `pnpm typecheck:web`, `pnpm exec oxlint --deny-warnings`, `pnpm exec oxfmt --check`, provider-registry `compat:check`.
