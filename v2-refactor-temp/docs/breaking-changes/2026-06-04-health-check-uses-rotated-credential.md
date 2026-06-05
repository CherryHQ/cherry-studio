---
title: Model health check uses the provider's rotated credential, not a chosen key
category: changed
severity: notice
introduced_in_pr: #14911
date: 2026-06-04
---

## What changed

The provider model health check no longer tests an individually selected API key. Each model
is probed once using the provider's normal rotated credential. The per-key "single vs all"
selection in the health-check drawer therefore no longer changes which credential is exercised,
and the multi-key "partial" outcome (some keys pass, some fail) is no longer produced.

## Why this matters to the user

A user with multiple API keys configured for one provider used to see a per-key pass/fail
breakdown. Now the check reports a single result per model (pass or fail), reflecting whichever
key the provider's rotation resolves at probe time. If only some of several keys are invalid,
the health check will not pinpoint which one.

## What the user should do

Nothing required. To validate a specific key, temporarily configure that key alone for the
provider and run the check.

## Notes for release manager

The v2 inference path never threaded a per-key override through `AiBaseRequest` → IPC →
provider config, so the previous per-key UI was already exercising the rotated credential N
times rather than each key. This change stops the redundant N identical probes and documents
the behavior. Threading a real per-key override is deferred (invasive). The drawer's per-key
selection controls are now inert and slated for removal in a follow-up.
