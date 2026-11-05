# Agent Note: Small third-party context windows in Claude Code

Status: implemented

English | [中文](2026-10-21-claude-code-small-context.zh.md)

## Problem

The SDK's 100,000-token `autoCompactWindow` minimum also gated the CLI's context and output limits. A third-party model declaring 49,152 tokens therefore received neither limit and could exceed its real context before compaction.

## Decision

Pin valid declared context windows independently of `autoCompactWindow`. Below 100,000 tokens, leave that unsupported SDK setting absent, default the compaction percentage to 60, and reserve at most one quarter of the declared window for output. The quarter-window cap also applies to explicit output overrides; smaller valid overrides retain their value. Explicit context and compaction-percentage overrides retain precedence.

## Alternatives considered

- Pass a smaller `autoCompactWindow`: rejected because the SDK rejects values below its minimum.
- Pass the 100,000-token floor or retain the generic output default: rejected because neither represents the smaller backend's real budget.
- Preserve every explicit output override: rejected because an oversized reservation can consume the input headroom this repair protects.

## Consequences

Small-window models compact earlier and may receive a smaller output allowance, including when the configured output override exceeds the quarter-window cap. For a 49,152-token window, 4,096 stays unchanged while 32,768 becomes 12,288. Models at or above 100,000 tokens retain the existing policy. Missing or invalid declared windows do not acquire context or output pins.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts`: covers 49,152-, 64,000-, and 99,999-token windows, the inclusive 100,000-token boundary, invalid metadata, and safe versus oversized explicit output overrides.
- Regression — An isolated CLI 2.1.284 protocol probe against a synthetic local endpoint reports a 49,152-token context and sends `max_tokens: 4096` or `max_tokens: 12288` as configured; both runs finish successfully.

A real Cherry Studio session against a third-party backend is not verified by these unit tests or the synthetic protocol probe.
