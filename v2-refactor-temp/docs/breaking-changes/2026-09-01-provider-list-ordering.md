---
title: Model provider list ordering changed
category: changed
severity: notice
introduced_in_pr: "#19488"
date: 2026-09-01
---

## What changed

Enabling or disabling an existing model provider now preserves its current list position. Newly added custom providers appear at the top of the provider list.

## Why this matters to the user

The Model Services list no longer reorders an existing provider when its enabled state changes, and a newly added provider is immediately visible at the top.

## What the user should do

Nothing — the new ordering behavior is automatic.

## Notes for release manager

Explicit drag-and-drop ordering remains unchanged.
