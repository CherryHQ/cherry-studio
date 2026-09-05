---
title: Yi provider is no longer available
category: removed
severity: breaking
introduced_in_pr: "#20016"
date: 2026-09-05
---

## What changed

Existing Yi (01.AI) provider configurations and preset-derived copies are now hidden and unavailable. The provider was already absent from the built-in catalog; this change also prevents creating retired identities and importing them through the v1-to-v2 migration.

## Why this matters to the user

The official platform service adjustment notice states that model experiences, API calls, and related services stopped at September 3, 2026, 24:00. Assistants and conversations referencing this provider require another provider for new generations.

## What the user should do

Select a model from another available provider. Existing local provider records, credentials, and conversation history are not deleted. The notice states that balance refund applications remain open until December 3, 2026, 24:00.

## Notes for release manager

Source: the official 01.AI platform service adjustment notice supplied with the change request. Retirement is based on provider identity, including preset-derived copies, rather than model names; Yi models served by other providers are unaffected.
