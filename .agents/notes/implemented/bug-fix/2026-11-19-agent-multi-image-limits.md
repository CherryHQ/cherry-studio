# Agent Note: Capability-driven multi-image limits for Agent requests

Status: implemented

English | [中文](2026-11-19-agent-multi-image-limits.zh.md)

## Problem

Agent requests containing multiple images failed upstream with `At most 1 image(s) may be provided in one prompt`, after a paid request was already sent. Chat tolerates multiple images (native vision input or the OCR fallback), but Agent turns forward attachments through runtime-specific channels — Pi and Pi-Durable as absolute file paths the agent reads with its tools, Claude Code as native Anthropic image blocks — with no shared image definition, no per-model limit, and no pre-send validation. Retry behavior for the rejected turn was unverified.

## Decision

`src/shared/ai/agentImageLimits.ts` owns one image predicate and order-preserving counters shared by message parts, runtime payloads, and composer attachments. `resolveMaxAgentImages` reads the production `Model` contract (`Model.maxAgentImages` in `src/shared/data/types/model.ts`): explicit per-model declarations win, vision models without one are unlimited (supported models receive every image in the user's order), and non-vision models defer to the existing graceful fallbacks (OCR text, path references, Read guards) instead of a new upfront block. `ModelService.customRowToRuntimeModel` and `ProviderRegistryService.mergePresetModel` propagate the cap defensively (future catalog/override/DB values flow through; today no provider declares one), and `enrichRowsFromRegistryTx` inherits registry caps for custom rows. `assertAgentImageLimit` throws `AgentImageLimitError` carrying the actual limit, count, and `sent` flag; an upstream `At most N image(s)` parser converts provider rejections into the same shape, with `sent: true` for result-boundary failures.

Enforcement runs before any paid provider call and before any DB writes. `AgentChatContextProvider.validateDispatch` validates the turn's image count against the turn model's limit, and `prepareAgentSessionDispatch` re-checks before the busy `saveMessage` and before the idle `persistDispatchTx`, so an over-limit submission never leaves a committed user row or a pending assistant row without a stream to settle it; on the enqueue/beginTurn race the just-committed rows are deleted best-effort and the limit error stays authoritative. The renderer composer blocks in `handleSendDraft` and re-checks in `sendQueuedPayload` when follow-ups drain, so a model change while queued cannot slip through. Main `AgentSessionRuntimeService` validates in `beginTurn`, `enqueueUserMessage`, and `admitTurn`, covering composer sends, retries, follow-ups, steers, and channel/remote inputs for every runtime; `admitTurn` validates against the turn's captured `turn.modelId` (matching `connectionTarget` for live turns) so an agent-default change during connection opening cannot re-gate the opening turn. Claude Code additionally guards native image-block construction (before file I/O and the SDK call), normalizes SDK admission rejections that name an upstream cap, and normalizes provider `result` failures via `normalizeResultImageLimitFailure` using the last submitted image count with sent-aware wording. Rejected pre-send turns keep drafts and history intact, so retry preserves attachments and instructions. Four locale keys (`agent.image_limit_exceeded`, `error.agent_image_limit_exceeded`, `error.agent_image_limit_exceeded_after_send`, `error.agent_image_limit_detail`) ship translated in all 18 catalogs.

## Alternatives considered

- Silently dropping or downsampling extra images: loses user data without consent; rejected.
- Auto-batching images across sequential turns: changes comparison and multi-screenshot semantics, which require all images in one prompt; the chosen behavior is block-with-limit.
- A new provider-registry catalog field for chat image limits: heavier compat/version surface for metadata no provider declares today; the `Model.maxAgentImages` contract with defensive registry/row propagation keeps the hook without catalog churn, and a future catalog/DB value flows through without touching call sites.
- Converting mid-turn Pi tool-read failures: Pi attaches images lazily through tools, so only initial attachments are pre-validated; the provider's own limit text still surfaces for the rest via the sent-aware normalizer.

## Consequences

Out-of-the-box behavior is unchanged: with no declared limit, every runtime forwards all attached images in order. Enforcement is fail-closed only when a limit is declared or an upstream rejection names one. Pre-send validation runs before DB writes, so over-limit turns leave no orphaned user rows, pending assistant rows, or remote reservations; the sent-aware result boundary (`sent: true`, `error.agent_image_limit_exceeded_after_send`) shows the request was already sent. Non-vision fallback behavior is untouched, and painting `maxInputImages` remains a separate image-generation concern.

## Verification

- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`: one, multiple, and over-limit image inputs; resolver defaults and `Model`-contract declarations (`ModelSchema` parses `maxAgentImages`); upstream limit parsing; sent-aware result normalization (`sent: true`, `after_send` key).
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`: single-image admission, pre-turn rejection with no entry created, multi-image order preservation, enqueue rejection with an empty queue; production-contract block (schema-valid model stops dispatch before provider); opening-turn model controls admission when the default changes mid-open.
- Regression — `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`: over-limit idle dispatch commits no rows and never reaches `beginTurn`; over-limit busy dispatch saves no user row and never enqueues; enqueue/beginTurn race after save/persist deletes just-committed rows.
- Regression — `src/main/ai/runtime/__tests__/agentUserContent.test.ts`: Pi/Durable forward every attached image and non-image files in the user's order.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`: provider result caps normalize to typed sent-aware `AgentImageLimitError`; unrelated failures and unknown counts pass through.
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`: over-limit send blocked with the limit message and draft kept; unlimited multi-image send proceeds.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`: text-only admission paths unchanged.
- Regression — `npx oxlint --deny-warnings` on all touched source and test files; `tsrs --noEmit` on node and web projects; `npx tsx scripts/i18n-check.ts` (124,546 strings + `after_send` key in all 18 catalogs).
