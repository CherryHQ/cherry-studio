---
title: Thinking summary moved into the composer; migrated service tier / verbosity dropped
category: moved
severity: notice
introduced_in_pr: #18449
date: 2026-08-21
---

## What changed

OpenAI models now return a thinking summary by default, and its verbosity
(Auto / Concise / Detailed) is picked per conversation from the speed control
next to the send button — the same popover that holds the reasoning effort
slider. The row only appears for hosts that accept the parameter (OpenAI,
Azure OpenAI, Codex).

Three provider-level settings carried over from v1 are gone: reasoning summary,
service tier, and verbosity.

## Why this matters to the user

Before this change, OpenAI reasoning models (gpt-5, o-series) showed **no
thinking content at all** in Cherry, because the summary parameter was never
sent. After upgrading, thinking appears without any configuration.

Service tier and verbosity were only reachable by users who migrated from v1
with those values already set — v2 never offered a way to view or change them.
Those values now stop being applied. Requests otherwise behave the same;
low-latency inference is still available through the Fast (⚡) button in the
same popover.

## What the user should do

Nothing — automatic. To change the summary verbosity, open the speed control
in the composer and pick Concise or Detailed.

## Notes for release manager

Third-party OpenAI-compatible hosts (Volcengine Ark, Alibaba DashScope,
DeepSeek, …) are unaffected: they emit thinking summaries on their own and
reject the parameter, so the control is not shown for them.
