---
title: Agent output budgets now respect model limits
category: changed
severity: notice
introduced_in_pr: '#20353'
date: 2026-09-13
---

## What changed

Agent requests now cap a configured output-token budget at the selected model's declared output limit.
Anthropic thinking tokens are included in that cap. Pi Agent requests through OpenAI-compatible endpoints
also let the endpoint choose its default output limit instead of sending the catalog ceiling automatically.

## Why this matters to the user

Gateways no longer receive an oversized configured budget, or a catalog ceiling that can exceed the limit
served by that gateway. Existing explicit budgets below the model limit are unchanged.

## What the user should do

Nothing — automatic.
