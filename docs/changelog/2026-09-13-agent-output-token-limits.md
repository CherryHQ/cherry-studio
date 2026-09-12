---
title: Agent output budgets now respect model limits
category: changed
severity: notice
introduced_in_pr: '#20353'
date: 2026-09-13
---

## What changed

Agent requests now cap a configured output-token budget at the selected model's declared output limit.
Anthropic thinking tokens are included in that cap.

## Why this matters to the user

Gateways no longer reject Agent requests solely because the configured output budget exceeds the model's
accepted maximum. Existing budgets below the model limit are unchanged.

## What the user should do

Nothing — automatic.
