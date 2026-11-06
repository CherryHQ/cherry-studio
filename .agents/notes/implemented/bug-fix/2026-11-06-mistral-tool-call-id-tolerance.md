# Agent Note: Tolerate missing IDs in Mistral streaming tool calls

Status: implemented

English | [中文](2026-11-06-mistral-tool-call-id-tolerance.zh.md)

## Problem

In `@ai-sdk/mistral@3.0.30`, `mistralChatChunkSchema` requires both `tool_calls[].id` and `function`. When the provider's first tool-call delta omits `id`, the entire chunk fails with `TypeValidationError` at `choices.0.delta.tool_calls.0.id`. The report in Issue #23741 also has an empty `function.name`. The adapter inserts an error part into the stream and continues, losing the ToolCall; the user sees “Unknown error”.

## Decision

The vendored patch at `patches/@ai-sdk__mistral@3.0.30.patch` makes streaming `index`, `id`, `function.name`, and `function.arguments` nullish. The `function` object itself becomes `.optional()`; explicit `null` remains invalid.

Instead of emitting start/delta/end/call directly for each delta, the adapter accumulates fragments by index → id → latest call. On the first fragment with a string name, it fixes the public ID once, using the provider's `id` or `generateId()`. A real ID arriving later becomes an alias and never replaces the public ID.

At `flush`, the adapter checks all unresolved skeletons first and throws `InvalidResponseDataError: Expected 'function.name' to be a string.` before emitting any final `tool-call`. The patch registration records removal only when an upstream version tolerates first fragments without an ID and all repository regression cases pass without the patch.

## Alternatives considered

- Upgrade `@ai-sdk/mistral` to 3.0.79: a first-seen fragment with `id == null` still throws `InvalidResponseDataError: Expected 'id' to be a string.`, and the upgrade brings unrelated request serialization changes. That version alone is not a removal criterion.
- Swallow error parts or supply a default ID in the application: this also lets malformed chunks through and cannot recover the lost tool call.
- Retry only in the application: the stream is single-pass, so retrying cannot recover fragments already discarded from it.

## Consequences

Final `tool-input-end` and `tool-call` parts are emitted at the end of the stream. This changes tool execution timing and their order relative to text/reasoning/raw parts. Empty arguments no longer produce empty `tool-input-delta` parts.

If the provider never supplies a non-empty name, the tool name remains an empty string and execution fails because that tool cannot be found. This repair only guarantees that a missing `id` no longer discards the entire turn. A synthesized ID is a client correlation identifier; whether the provider accepts it in the next turn requires verification on a real provider connection.

## Verification

The following checks passed in the preceding implementation round; they are recorded here without rerunning them for this documentation-only follow-up.

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts src/main/ai/provider/__tests__/openaiCompatibleToolCallSkeletonPatch.test.ts`: exit 0; both files passed, 40 tests in total. The 11 new cases cover the reported payload, skeletons, missing IDs, native single-chunk deep equality, unresolved skeletons, withholding completed calls until skeleton validation, interleaved indexes, invalid `function`, `streamText` + `execute` pairing, and plain text.
- Regression — `node node_modules/oxlint/bin/oxlint --deny-warnings src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`: exit 0.
- Regression — `node node_modules/oxfmt/bin/oxfmt --check src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`: exit 0.
- Regression — `NODE_OPTIONS=--max-old-space-size=16384 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: exit 0.
- Regression — `pnpm install --frozen-lockfile --ignore-scripts`: exit 0; the lockfile was unchanged.
