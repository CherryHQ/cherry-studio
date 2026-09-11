---
title: Providers start disabled until models are available
category: changed
severity: notice
introduced_in_pr: #15686
date: 2026-06-06
---

## What changed

New and preset providers (except CherryAI) are now created and seeded **disabled**. They auto-enable once usable models are discovered through the existing provider-settings flows (auto model sync, pull reconcile, or a successful connection check).

## Why this matters to the user

On a fresh install, most providers appear disabled in Settings → Providers until a model list has been fetched. They remain visible because the provider sidebar now defaults to showing all providers. Existing installs are unaffected — the migration preserves each provider's current enabled state.

## What the user should do

Nothing — automatic. Adding an API key (or otherwise triggering model discovery) enables the provider; a provider can also be toggled on manually from the sidebar.
