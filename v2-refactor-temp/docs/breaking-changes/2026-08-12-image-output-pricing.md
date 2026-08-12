---
title: Image models can price output by token or image count
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-12
---

## What changed

Image generation and editing models now expose an image output pricing choice in the model editor. Users can keep
token-based calculation or enter a price per generated image; the selected method applies to new usage records.

## Why this matters to the user

Estimated image costs can now match providers that bill by image count. In token mode, a cost is calculated only when
the provider reports image token usage; provider-reported costs still take precedence over either local calculation.

## What the user should do

Choose the provider's billing method in Settings → Model Providers → Manage Models. Enter a per-image price when using
image-count calculation; no action is required for models that should continue using token prices.

## Notes for release manager

Historical usage records are not recalculated. Custom asynchronous image transports currently do not report token
usage, so they still need provider-reported cost or per-image pricing for a local estimate.
