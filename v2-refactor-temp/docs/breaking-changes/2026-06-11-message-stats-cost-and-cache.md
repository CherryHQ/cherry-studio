---
title: Per-message cost and cache/reasoning token counts now shown
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-06-11
---

## What changed

Assistant messages now persist and display a richer usage breakdown: cache-read /
cache-write tokens, a text/reasoning output split, and a computed cost. Cost is
shown for every model with configured pricing (computed from per-token rates,
cache-aware), not only OpenRouter. For providers that report their actual billed
amount (currently OpenRouter), that reported figure is used instead. The message
token footer gains optional cache-read (⚡) and reasoning (🧠) counters.

For Claude / Claude Code, the headline input-token number now reflects
**non-cached** input only (the v6 convention); cached tokens are shown separately
and the total still includes them.

## Why this matters to the user

Users will see a cost estimate on more messages than before, plus cache-hit and
reasoning token counts in the per-message token footer. The input-token figure for
cache-heavy Claude conversations will look smaller than before because cache tokens
are now broken out rather than folded into the input count.

## What the user should do

Nothing — automatic. Configure per-model pricing under Provider settings if you
want cost estimates for a model that has no preset pricing.

## Notes for release manager

Cost source is recorded per message (`provider` vs `computed`) with a pricing
snapshot for auditability. Reliable-provider cost is data-driven via the
`reportsActualCost` provider flag in the registry, not a hardcoded list.
