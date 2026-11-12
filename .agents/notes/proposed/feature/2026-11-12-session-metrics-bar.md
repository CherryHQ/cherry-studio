# Agent Note: Session metrics bar

Status: proposed

English | [中文](2026-11-12-session-metrics-bar.zh.md)

## Problem

Agent chat shows token and timing stats only per message. Users cannot see session-level turns, tool-call steps, input tokens, or cache hit rate, so they cannot judge session cost or decide when to start a new session. Tracking issue: CherryHQ/cherry-studio#19707.

## Proposal

Add a compact metrics bar above the agent input showing turns, tool-call steps, input tokens, cache hit rate, time to first token, and tokens per second. The bar is visible by default and collapses to a single line; clicking expands it for details. A settings toggle hides it.

All values are derived in the renderer from the existing per-message stats. No schema, IPC, or persistence changes.

- Cache hit rate = sum(cacheReadTokens) / sum(inputTokens). Shown as "—" when either sum is unavailable.
- Turns = completed assistant turns in the session. Tool-call steps = tool-call parts across those turns.
- LLM wall time is excluded because its definition is ambiguous.

## Alternatives considered

- Main-process aggregation exposed over IPC: adds a round trip and a service boundary for data the renderer already holds. Not chosen.
- Persisted session counters: needs a migration and write-path changes for values that can be recomputed. Not chosen.

## Acceptance criteria

- AC1: For a fixture session, the bar shows turns, tool-call steps, input tokens, cache hit rate, time to first token, and tokens per second matching the sums of the per-message stats.
- AC2: Turning the setting off hides the bar; turning it on shows it again.
- AC3: Cache hit rate equals sum(cacheReadTokens) / sum(inputTokens) for the fixture.
- AC4: The bar updates after a turn completes.
- AC5: A metric with missing source data renders "—", not 0.

## Risks

- Providers other than Claude Code may omit cache or timing fields, so some metrics will often show "—".
- Summing input tokens per API call counts repeated context each call. This matches the billed input total the issue asks for, but it should be labeled clearly.
- Recomputing over long sessions on every message update may cost render time. Memoize by message list identity.
