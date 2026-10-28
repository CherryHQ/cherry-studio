# Agent Note: Bounded delivery of Claude Code identity snapshots

Status: implemented

English | [中文](2026-10-28-claude-code-identity-context-cap.zh.md)

## Problem

Claude Code, the CLI subprocess, limits hook `additionalContext` to 10,000 UTF-16 code units per string. Above that limit it saves the content in the session directory and gives the model only the file path and a 2,000-unit preview, without an error or warning. `createClaudeCodeIdentityHooks()` previously returned the complete `PromptBuilder.buildMemoriesSection()` snapshot as one string. When `SOUL.md`, `USER.md`, and `memory/FACT.md` together exceeded the limit, only the preview reached the model each turn. Issue #22945 reported an 86,178-character snapshot with 2.32% reaching the model.

Probes using the real `@anthropic-ai/claude-agent-sdk` 0.3.284 binary and a local mock upstream established the boundary: 10,000 units arrived intact; truncation began at 10,001. Pure Chinese text of 9,000 characters / 27,000 bytes arrived intact, while emoji text at 10,001 UTF-16 units was truncated. The limit counts neither bytes nor code points.

Multiple hooks for one event are measured independently: both strings in a 2×8,000-unit probe arrived intact. Hooks execute concurrently, however, and enter context in completion order. Delaying callback 0 by 250ms put callback 1's content first; array order does not determine model-visible order. Callback counts are fixed when the query is established, because SDK initialize serializes callback IDs, and there is no public dynamic registration API. A local repair therefore needs an explicit capacity limit.

## Decision

Keep the hook channel and both events. `SessionStart` forces a resend, including after compaction; `UserPromptSubmit` deduplicates on the connection. Each event registers one matcher containing 16 fixed callbacks. Each part has a 9,600-unit body budget, giving a nominal capacity of 153,600 units. Capacity is decided by the actual slice count; newline and surrogate-pair boundaries can reduce it below the nominal value.

Each part carries `<agent_identity_part>` metadata with `batch`, `part="k/N"`, `units`, and `truncated`, plus fixed instructions: parts may arrive out of order, concatenate bodies by part number without changing characters, the whole batch replaces every earlier identity snapshot, and one part is not a complete snapshot. Slicing is a pure, lossless function: `chunks.join('') === snapshot`, surrogate pairs stay intact, and cuts prefer newlines.

All slots share one snapshot read and one send decision per event occurrence. When the snapshot is unchanged, all 16 slots return `{}`. Cancellation or failure does not update `delivered`, and an older batch cannot overwrite a newer batch's delivery state.

When capacity is exceeded, deliver a prefix and mark every part `truncated="true"`. The last part reports `snapshotUnits`, `deliveredUnits`, `omittedUnits`, and the absolute paths of `SOUL.md`, `USER.md`, and `memory/FACT.md`. It declares omitted contents unknown and forbids filling them from an older snapshot. Main emits a connection-scoped, deduplicated structured warning without snapshot text. If the overflow notice and wrapper cannot themselves fit, send no batch and emit a warning.

The stable system prompt also explains that the runtime may deliver one or more `<agent_identity_part>` contexts, possibly out of order, that bodies must be joined by `part`, and that only a whole batch is complete.

## Alternatives considered

1. Move to `systemPrompt.append`, the issue's preferred suggestion: `snapshot:false` makes the CLI re-render on each request but does not call Cherry back to reread files, so it cannot preserve per-turn refresh on a warm connection or the latest file versions after compaction without changing the query/driver lifecycle.
2. Return the complete snapshot from one callback: the per-string limit still applies.
3. Add only UI or log warnings: this exposes the loss but does not restore identity delivery.
4. Fall back to file paths and explicit Read instructions on overflow: this requires a model tool call and breaks `prompt.ts`'s existing contract that identity is available without Read; probes found the persisted file intact, but its tail remains invisible unless the model reads it.
5. Fix hook context delivery in the upstream CLI, by delivering trusted SDK callbacks' `additionalContext` losslessly or providing an ordered batch of strings: this fixes the layer responsible for the loss, since the control protocol already carries all 86,178 characters intact, but requires an upstream implementation and release outside this repository PR; this PR applies a bounded local repair and records that upstream direction in the issue discussion.

## Consequences

Within capacity, the complete identity reaches the model without a tool call, including compaction reinjection, resume reload, and per-turn refresh; unchanged snapshots are not injected again. The cost is 16 callback control round trips on every `UserPromptSubmit`, even when unchanged. A probe comparing 9 parts with 1 part measured about 28ms difference for the whole query; unchanged turns inject no body.

Arrival order is not guaranteed, so the protocol relies on metadata. Model reconstruction remains an instruction contract rather than a deterministic execution guarantee, the same premise already used by [the agent prompt layers](../../../../docs/references/ai/agent-prompt-layers.md).

Above 153,600 units, or the lower actual capacity imposed by newline/surrogate boundaries, delivery explicitly degrades to a prefix, accurate counts, and source paths. Completing it with Read depends on tool availability and permissions. Here, “delivered” means all 16 local callbacks prepared their returns, not that the CLI or model acknowledged receipt. The SDK provides no shared event-instance ID, so late slots from overlapping events with the same key cannot be statically distinguished; the code documents this limitation.

UI-visible warnings through i18n, IPC, and toast remain a follow-up outside this PR.

## Verification

The following are recorded runs from this PR, not reruns performed while adding this note.

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/identity.sdkContract.test.ts -t 'delivers the complete oversized Claude identity without a tool read'` (RED, complete oversized identity): with only the new test copied into the probe at base `1250b45` and product files unchanged, `Tests 1 failed | 5 skipped`, rc=1; `expect(text).toContain('IDENTITY_FACT_TAIL_22945_7d2c86ea')` failed because model messages contained `<persisted-output>` and a 2,000-unit preview.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/identity.sdkContract.test.ts` (GREEN, native SDK identity contract): 6 passed, rc=0; the oversized identity reassembles to exactly the original `buildMemoriesSection()` string without Read, and long identity survives the first turn, a tail edit, an unchanged turn, real compact, and resume.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/identityChunks.test.ts src/main/ai/runtime/identity.test.ts src/main/ai/agents/__tests__/prompt.test.ts` (chunking, hook state, and prompt contract): 69 passed, rc=0.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/buildSystemPrompt.test.ts src/main/ai/runtime/claudeCode/__tests__/hooks.steer.test.ts src/main/ai/runtime/claudeCode/__tests__/bashOutcomeRecording.test.ts` (affected consumers): 211 passed, rc=0.
- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` and `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false` (static types): both rc=0; the web check required the increased heap.
- Regression — `node node_modules/oxlint/bin/oxlint --deny-warnings`, `node node_modules/eslint/bin/eslint.js --no-cache`, and `node node_modules/oxfmt/bin/oxfmt --check` (with the changed-file arguments recorded in the PR validation logs): all rc=0 for the checked source files; Oxfmt ignored Markdown, so this is not Markdown formatting evidence.
- Regression — `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/check-doc-links.ts`, `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-doc-structure.ts`, `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-doc-frontmatter.ts`, `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-translation-pairing.ts`, `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/gen-doc-index.ts --check`, and `git diff --check` (documentation and whitespace gates): all five docsGovernance checks and the diff check returned rc=0.

Chinese snapshots are measured in UTF-16 units: 9,000 Chinese characters = 27,000 bytes still arrived intact, so truncation is not byte-based.
