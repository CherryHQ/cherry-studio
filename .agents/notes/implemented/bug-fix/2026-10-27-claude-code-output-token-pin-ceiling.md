# Agent Note: Claude Code pinned catalog output caps the endpoints reject

Status: implemented

English | [中文](2026-10-27-claude-code-output-token-pin-ceiling.zh.md)

## Problem

`resolveRequestedOutputTokens` in `src/main/ai/runtime/claudeCode/environment.ts` pinned the model catalog's `maxOutputTokens` into `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, bounded only by the bundled CLI's own 128,000 ceiling. A catalog value states what the model can emit, not what the endpoint serving it accepts.

Reported as #22332 with grok-4.6 in Work: the catalog declares a 500,000 output cap, so every agent turn put `max_tokens: 128000` on the wire, and xAI's Anthropic-compatible endpoint rejected it with `400 Field 'max_tokens' must be at most 65536`. The failure is total — no turn starts — and the 128,000 ceiling could never have prevented it, because it sits above the limit at which the request is refused.

## Decision

The pin keeps the accepted maximum as its ceiling, and the catalog value only raises the pin toward it:

```ts
const MAX_REQUESTED_OUTPUT_TOKENS = 65_536
```

grok-4.6 now pins exactly 65,536. The value is the boundary the endpoint names in its own error, and the highest a model can be given without a request being refused. The CLI clamps `max_tokens` here anyway, so reserving more would only starve the compaction budget for room no request can use.

An explicit agent `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is held to the same ceiling: it feeds the same request, so the same 400 applies, and the compaction budget subtracts the clamped value it actually pins.

## Alternatives considered

- Hold every pin to the CLI's 32,000 default: rejected because it also cuts models that legitimately declare 48K–64K output — their turns begin stopping at `length` far earlier than before, a silent regression rather than an error.
- Keep the 128,000 ceiling and clamp only on the gateway branch: rejected because the fix lives in `buildEnvironment`, which runs before the route is resolved; the direct branch speaks Anthropic Messages to the same third-party endpoints and is refused identically.
- Read a per-provider output ceiling from the registry: the right long-term shape, but no such declaration exists today; inventing one for a single reported provider is a larger design change than the bug requires.

## Consequences

Catalog caps above 65,536 no longer reach the wire; grok-4.6 requests 65,536 instead of 128,000. Models declaring less than 65,536 are unchanged and still pin their declared cap. A first-party or native Anthropic model that declares a larger cap is also held to 65,536, so its agent turns truncate earlier than the model allows; that is the accepted cost of one uniform bound until an endpoint-aware ceiling exists.

## Verification

- Regression — `vitest run --project main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`: 228 tests pass. New: a 500K catalog cap on a 500K window pins `65536` while the compaction window stays above 400K (the #22332 case, which pinned `128000` before); a `CLAUDE_CODE_MAX_OUTPUT_TOKENS=500000` override is normalized in the subprocess env to the clamped `65536` it is budgeted for, `48000` passes through intact, and an oversized override is normalized even with an absent or sub-minimum context window while a catalog-derived value stays unpinned there; `393_216` still pins the ceiling; `16_384` still pins its declared cap.
- `oxlint --deny-warnings` and `oxfmt` pass on both changed files.
