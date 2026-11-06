# Agent Note: Configurable recent verbatim retention

Status: implemented

English | [中文](2026-11-06-context-compression-keep-percent.zh.md)

## Problem
Users could not adjust the amount of recent original context retained after compression.

## Decision
Add a global percentage of the compression trigger, defaulting to 37.5, with an optional assistant override. Both compression lanes use the resolved share.

## Alternatives considered
Keeping the fixed fraction preserves the limitation; using a fraction of the entire window changes the meaning of the budget.

## Consequences
Whole turns are retained and summaries use additional space. An empty assistant override inherits the global value.

## Verification
- AC1 — Default budgets are 1200 at trigger 3200 and 750 at trigger 2000. (verification: unit)
- AC2 — Both lanes retain more recent content with a larger share. (verification: unit)
- AC3 — Global and assistant controls expose the share; clearing the assistant field inherits the global value. (verification: renderer)
- AC4 — The global control saves 62.5 to `chat.context_settings.compress.keep_percent` and shows 62.5 again after an app restart. (verification: Electron)
