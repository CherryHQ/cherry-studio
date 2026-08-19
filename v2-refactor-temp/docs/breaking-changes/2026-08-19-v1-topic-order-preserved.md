---
title: Migrated conversations keep their V1 list order
category: data-migration
severity: notice
introduced_in_pr: pending
date: 2026-08-19
---

## What changed

Conversations migrated from V1 now keep the order the user set under each assistant. The previous migration stamped that list from last-updated time, which reversed deliberately dragged conversations.

## Why this matters to the user

After upgrading, a profile that still has V1 Redux data (`persist:cherry-studio`) is repaired once so assistant-mode matches the old list. Time mode and the right panel still group by recent activity and do not offer drag reorder.

## What the user should do

nothing — automatic. If V1 browser data was already cleared, restore order with assistant-mode drag, or rerun V1 migration from Settings > Data (that discards current V2 data).

## Notes for release manager

Does not implement time-mode recency grouping (#18205) or time-mode drag. Profiles with no remaining V1 persist are left as-is.
