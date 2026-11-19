# Agent Note: Tolerate missing IDs in Mistral streaming tool calls

Status: implemented

English | [中文](2026-11-06-mistral-tool-call-id-tolerance.zh.md)

## Problem

In `@ai-sdk/mistral@3.0.30`, `mistralChatChunkSchema` requires both `tool_calls[].id` and `function`. When the provider's first tool-call delta omits `id`, the entire chunk fails with `TypeValidationError` at `choices.0.delta.tool_calls.0.id`. The report in Issue #23741 also has an empty `function.name`. The adapter inserts an error part into the stream and continues, losing the ToolCall; the user sees “Unknown error”.

## Decision

The vendored patch at `patches/@ai-sdk__mistral@3.0.30.patch` makes streaming `index`, `id`, `function.name`, and `function.arguments` nullish. The `function` object itself becomes `.optional()`; explicit `null` remains invalid.

Instead of emitting start/delta/end/call directly for each delta, the adapter accumulates fragments by index → id → latest call. A fragment without a non-empty name is buffered with its arguments and its index/id keys, so a skeleton that only announces a call emits neither events nor errors. On the first fragment with a non-empty name, the adapter fixes the public ID once, using the provider's `id` or `generateId()`. A real ID arriving later becomes an alias and never replaces the public ID.

At `flush`, the adapter checks all unresolved skeletons first and throws `InvalidResponseDataError: Expected 'function.name' to be a string.` before emitting any final `tool-call`. The patch registration records removal only when an upstream version tolerates first fragments without an ID and all repository regression cases pass without the patch.

## Alternatives considered

- Upgrade `@ai-sdk/mistral` to 3.0.79: a first-seen fragment with `id == null` still throws `InvalidResponseDataError: Expected 'id' to be a string.`, and the upgrade brings unrelated request serialization changes. That version alone is not a removal criterion.
- Swallow error parts or supply a default ID in the application: this also lets malformed chunks through and cannot recover the lost tool call.
- Retry only in the application: the stream is single-pass, so retrying cannot recover fragments already discarded from it.

## Consequences

Final `tool-input-end` and `tool-call` parts are emitted at the end of the stream. This changes tool execution timing and their order relative to text/reasoning/raw parts. Empty arguments no longer produce empty `tool-input-delta` parts.

An empty `function.name` is treated as not yet known instead of as a name: a provider that only ever sends an empty name now fails with `Expected 'function.name' to be a string.` rather than producing a tool call whose name is the empty string. The latter would persist into the UI message and convert back to model history as an empty `toolName`, which the SDK renders as the bare `tool-` prefix.

## Verification

The following checks passed in the implementation round; the review-feedback round re-ran them for the empty-name and index-less correlation changes.

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts src/main/ai/provider/__tests__/openaiCompatibleToolCallSkeletonPatch.test.ts`: exit 0; both files passed, 43 tests in total. The cases cover the reported payload, skeletons, missing IDs, native single-chunk deep equality, unresolved skeletons, withholding completed calls until skeleton validation, interleaved indexes, index-less calls with distinct wire IDs, an empty name that never resolves, invalid `function`, `streamText` + `execute` pairing, the `readUIMessageStream` → `convertToModelMessages` round trip, and plain text.
- Regression — `node node_modules/oxlint/bin/oxlint --deny-warnings src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`: exit 0.
- Regression — `node node_modules/oxfmt/bin/oxfmt --check src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`: exit 0.
- Regression — `NODE_OPTIONS=--max-old-space-size=16384 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: exit 0.
- Regression — `pnpm install --frozen-lockfile --ignore-scripts`: exit 0; the lockfile was unchanged.
