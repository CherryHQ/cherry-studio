---
title: Legacy referenced files adopt automatic cleanup policy
category: changed
severity: low
introduced_in_pr: "#19287"
date: 2026-08-24
---

## What changed

Files created before the cleanup-policy rollout that are still referenced by migrated chat messages, paintings,
provider logos, or mini-app logos now use `delete_when_unreferenced` instead of the conservative `manual` fallback.

## Why this matters to the user

Nothing is deleted while one of those references exists. If a user later removes the owning message, painting,
provider logo, or mini-app logo, the normal cleanup sweep may reclaim the now-unreferenced managed file. Previously,
these legacy files were retained indefinitely.

## What the user should do

No action is required. Export or copy a managed file before removing its last owning item if it must be retained
independently.

## Notes for release manager

The migration is restricted to pre-rollout rows that still have the `manual` default and a durable reference in one
of the four legacy migration cohorts. User-created manual files and newer rows are unchanged.
