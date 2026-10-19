# Agent Note: Missing runtime capabilities in agent conversations

Status: implemented

English | [中文](2026-10-19-agent-runtime-capability-lookup.zh.md)

## Problem

An agent returned by the local DataApi had runtime type `local`, absent from the current capability matrix. Opening its session dereferenced the missing entry's `slashCommands` and crashed the Work page before the composer rendered.

## Decision

The renderer checks whether static runtime commands exist before offering context compaction. A live session command catalog takes precedence. Without either source, compaction recovery is unavailable and the conversation remains readable.

## Alternatives considered

- Map the unrecognized type to a supported runtime: rejected because the UI cannot infer execution compatibility.
- Rewrite the agent or session: unnecessary for preventing the presentation crash.

## Consequences

This changes capability presentation only. It does not map runtime identities, change execution admission, or rewrite stored agent/session data.

## Verification

- Regression — `pnpm test:renderer src/renderer/pages/agents/__tests__/useAgentChatRuntimeState.test.tsx src/renderer/pages/agents/__tests__/AgentPage.test.tsx`: 131 tests pass, including five command-capability cases. The unknown-type case reproduced the original exception before the fix.
- Regression — Real Electron: the original session opens with a visible composer and no `slashCommands` render exception after retry. Fixed application tab visuals remain intact.
