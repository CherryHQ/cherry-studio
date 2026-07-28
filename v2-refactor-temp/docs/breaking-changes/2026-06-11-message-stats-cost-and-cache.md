---
title: Per-message cost and cache/reasoning token counts now shown
category: changed
severity: notice
introduced_in_pr: "#15992"
date: 2026-06-11
---

## What changed

Assistant messages now persist and display a richer usage breakdown: cache-read /
cache-write tokens, a text/reasoning output split, and a computed cost. Cost is
shown for every model with configured pricing (computed from per-token rates,
cache-aware), not only OpenRouter. For providers that report their actual billed
amount (currently OpenRouter), that reported figure is used instead. The message
details hover card gains optional cache-read and reasoning token counters.

Provider-reported amounts that omit a currency are accepted only when the
provider registry explicitly declares that currency. Local image cost remains
unavailable unless the runtime model supplies explicit per-image pricing.

For Claude / Claude Code, the headline input-token number follows AI SDK v6 and
includes all input tokens, including cache reads and writes. The cache breakdown
is shown separately without subtracting it from the headline total.

## Why this matters to the user

Users will see a cost estimate on more messages than before, plus cache-hit and
reasoning token counts in the per-message details card. Cache-heavy Claude
conversations retain an all-in input-token headline while exposing the cached
portion separately.

## What the user should do

Nothing — automatic. Configure per-model pricing under Provider settings if you
want cost estimates for a model that has no preset pricing.

## Notes for release manager

Cost source is recorded per invocation (`provider` vs `computed`) with a
pricing snapshot for auditability, then projected per message. Reliable
provider cost and any amount-only currency are data-driven by registry
metadata, not a hardcoded runtime list or default currency.
