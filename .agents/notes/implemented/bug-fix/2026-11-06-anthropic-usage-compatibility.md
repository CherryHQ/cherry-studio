# Agent Note: Anthropic usage compatibility

Status: implemented

English | [中文](2026-11-06-anthropic-usage-compatibility.zh.md)

## Problem

The Anthropic provider requires usage metadata before accepting otherwise usable content. A missing initial input count, final output count, whole usage object, or iteration count rejects a response. The streaming first-event handler also wraps local schema failures as HTTP 500, causing misleading server-error display and transient-error retries. LongCat exposed this boundary defect; it is not a model-specific policy.

## Decision

The existing `patches/@ai-sdk__anthropic.patch` makes usage objects and input/output counts optional and nullable in streaming and non-streaming responses. Absent objects normalize to an empty metadata object at the schema boundary. Present malformed counts still fail validation; content and tool identity keep their existing requirements. No provider/model whitelist or runtime fallback is added.

Missing input/output totals remain unknown, including when an executor iteration lacks that count. Later reported cumulative counts replace earlier values; absent later counts do not erase them. Explicit zero remains zero. Cache buckets retain their existing protocol defaults, advisor iterations stay outside executor totals, and fallback responses retain top-level accounting. Derived totals and text-token counts never perform arithmetic on missing values. Raw extension metadata survives.

The first-event handler preserves `TypeValidationError` instead of inventing HTTP 500. Native overload events still produce retryable 529 responses. Public/internal ESM and CJS bundles share the repair; source and iteration metadata declarations reflect optional counts. The dependency stays at 3.0.125 and retains its existing signature and output-limit patches.

## Alternatives considered

- A LongCat-specific branch or one optional start field leaves the same failure in other models, non-streaming replies, final events, and aggregation.
- Replacing missing counts with zero makes unavailable usage look measured and can undercount partial iterations.
- Disabling response validation loses protection for content, tool identity, and malformed values.

## Consequences

The provider can deliver content without complete billing metadata. Consumers must continue to distinguish unknown counts from measured zero. This patch does not resolve other providers' validation policies or every optional Anthropic metadata field. [Issue #23715](https://github.com/CherryHQ/cherry-studio/issues/23715) tracks the cross-provider audit, error propagation, and consolidation with existing Responses work.

## Verification

- Regression — `src/main/ai/provider/__tests__/anthropicUsageCompatibilityPatch.test.ts`: 72 cases exercise missing/null/partial usage, delayed counts, iteration sums, raw extensions, invalid tool identity, validation errors, and native overload across four production SDK entries; 56 fail before the patch and all pass afterward.
- Regression — Eight explicitly selected provider, normalization, and Gateway test files pass 248 tests, including the existing signature/output-limit behavior and Anthropic stream conversion; this count includes the 72 patch cases.
- Regression — A restarted Electron instance using Pi Durable and LongCat-2.5 through the Anthropic endpoint reads a random local-file value absent from its prompt, displays and persists the reply, and records two usage entries. Evidence lives in `.context/cherry-electron-dev/anthropic-usage-live.json` and `electron-acceptance-usage-patch.log`; this does not establish live coverage for other providers.
