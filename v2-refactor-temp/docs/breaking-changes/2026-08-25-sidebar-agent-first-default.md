---
title: New installs place Agent first in the sidebar
category: changed
severity: notice
introduced_in_pr: "#19388"
date: 2026-08-25
---

## What changed

The default left-sidebar order for genuinely unconfigured users now starts with Agent, then Chat (Assistants), then Translate, Paintings, and Knowledge. Existing persisted sidebar order, drag-reorder, pin/hide, required Chat, and later launches are unchanged.

## Why this matters to the user

A brand-new install shows Agent as the first sidebar entry instead of Chat. Anyone who already has a stored sidebar order keeps that order after updating.

## What the user should do

Nothing — automatic. After first launch, the sidebar can still be reordered or hidden as before.

## Notes for release manager

This is only the generated `ui.sidebar.favorites` default. Preference seeding still skips existing rows, so already-seeded and customized sidebars must not be rewritten. v1→v2 migration continues to reset missing/legacy sidebar favorites to the current canonical default.
