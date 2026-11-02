# Agent Note: Claude Code Copilot Opus 5.5 gateway alias

Status: implemented

English | [中文](2026-11-02-claude-code-copilot-opus-55-alias.zh.md)

## Problem

Claude Code interprets the dotted Copilot model id as Opus 5 and uses a 200k local context budget, even when the selected model declares a 1M window.

## Decision

For internal gateway routes, use a narrow Claude version spelling alias only when enabled routable siblings cannot claim it. Add the CLI's 1M marker according to each slot's declared window and first-party host decision. Resolve the alias back to the original model row and wire id; match it in renderer usage only with the same eligibility check.

## Alternatives considered

- Global dot replacement would change unrelated model ids and could route to a different model.
- Keeping the dotted spelling preserves routing but leaves the CLI display incorrect.

## Consequences

Ambiguous aliases retain their original spelling. Catalogue changes can change the derived connection signature. Public gateway admission and wire ids remain unchanged.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts src/main/features/apiGateway/utils/__tests__/models.test.ts src/main/features/apiGateway/__tests__/proxyStream.parse.test.ts`: a Copilot dotted 1M model yields `copilot:claude-opus-5-5[1m]` for every slot, the internal alias resolves to the dotted row, ambiguous aliases are rejected, and these cases fail on the pristine base (5 failures) while the exact-address controls keep passing.
- Regression — bundled Claude Code 2.1.284 probe against a local mock: `copilot:claude-opus-5-5[1m]` reports canonical `claude-opus-5-5` with a 1000000 budget, while today's `copilot:claude-opus-5.5` reports `claude-opus-5` and 200000; the CLI strips the marker before egress.
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/agent/__tests__/useAgentSessionContextUsage.test.ts`: a gateway reading under the alias survives and is measured against the declared window (30% of 1M), while a colliding sibling or an unavailable sibling list keeps it filtered out.
- Regression — not verified here: an authenticated Copilot account serving a real 1M request, and the first-party subscription path.
