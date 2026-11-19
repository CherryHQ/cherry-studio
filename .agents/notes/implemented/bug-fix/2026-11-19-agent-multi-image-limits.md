# Agent Note: Capability-driven multi-image limits for Agent requests

Status: implemented

English | [中文](2026-11-19-agent-multi-image-limits.zh.md)

## Problem

Agent requests containing multiple images failed upstream with `At most 1 image(s) may be provided in one prompt`, after a paid request was already sent. Chat tolerates multiple images (native vision input or the OCR fallback), but Agent turns forward attachments through runtime-specific channels — Pi and Pi-Durable as absolute file paths the agent reads with its tools, Claude Code as native Anthropic image blocks — with no shared image definition, no per-model limit, and no pre-send validation. Retry behavior for the rejected turn was unverified.

## Decision

`src/shared/ai/agentImageLimits.ts` owns one image predicate and order-preserving counters shared by message parts, runtime payloads, and composer attachments. `resolveMaxAgentImages` is capability-driven: explicit per-model declarations win, vision models without one are unlimited (supported models receive every image in the user's order), and non-vision models defer to the existing graceful fallbacks (OCR text, path references, Read guards) instead of a new upfront block. `assertAgentImageLimit` throws `AgentImageLimitError` carrying the actual limit and count; an upstream `At most N image(s)` parser converts provider rejections into the same shape.

Enforcement runs before any paid provider call. The renderer composer blocks in `handleSendDraft` and re-checks in `sendQueuedPayload` when follow-ups drain, so a model change while queued cannot slip through. Main `AgentSessionRuntimeService` validates in `beginTurn`, `enqueueUserMessage`, and `admitTurn`, covering composer sends, retries, follow-ups, steers, and channel/remote inputs for every runtime. Claude Code additionally guards native image-block construction (before file I/O and the SDK call) and normalizes SDK admission rejections that name an upstream cap. Rejected turns keep drafts and history intact, so retry preserves attachments and instructions. Three locale keys (`agent.image_limit_exceeded`, `error.agent_image_limit_exceeded`, `error.agent_image_limit_detail`) ship translated in all 18 catalogs.

## Alternatives considered

- Silently dropping or downsampling extra images: loses user data without consent; rejected.
- Auto-batching images across sequential turns: changes comparison and multi-screenshot semantics, which require all images in one prompt; the chosen behavior is block-with-limit.
- A new provider-registry catalog field for chat image limits: heavier compat/version surface for metadata no provider declares today; a defensive per-model read keeps the hook without catalog churn.
- Converting mid-turn Pi tool-read failures: Pi attaches images lazily through tools, so only initial attachments are pre-validated; the provider's own limit text still surfaces for the rest.

## Consequences

Out-of-the-box behavior is unchanged: with no declared limit, every runtime forwards all attached images in order. Enforcement is fail-closed only when a limit is declared or an upstream rejection names one. Non-vision fallback behavior is untouched, and painting `maxInputImages` remains a separate image-generation concern.

## Verification

- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`: one, multiple, and over-limit image inputs; resolver defaults and declarations; upstream limit parsing.
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`: single-image admission, pre-turn rejection with no entry created, multi-image order preservation, enqueue rejection with an empty queue.
- Regression — `src/main/ai/runtime/__tests__/agentUserContent.test.ts`: Pi/Durable forward every attached image and non-image files in the user's order.
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`: over-limit send blocked with the limit message and draft kept; unlimited multi-image send proceeds.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`: text-only admission paths unchanged.
- Regression — `npx oxlint --deny-warnings` on all touched source and test files; `tsrs --noEmit` on node and web projects; `npx tsx scripts/i18n-check.ts` (124,546 strings).
