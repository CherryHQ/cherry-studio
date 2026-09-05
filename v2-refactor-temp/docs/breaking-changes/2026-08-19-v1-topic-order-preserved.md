---
title: Migrated conversations keep their V1 list order
category: data-migration
severity: notice
introduced_in_pr: "#18909"
date: 2026-08-19
---

## What changed

Conversations migrated from V1 now keep the order the user set under each assistant. The previous migration stamped that list from last-updated time, which reversed deliberately dragged conversations.

## Why this matters to the user

During V1-to-V2 migration, assistant-mode conversations and pins now follow the order in the migration-owned V1 Redux export. Normal V2 startup does not read the removed V1 Redux store, so later V2 reorders and recreated pins keep their current placement. Time mode and the right panel still group by recent activity and do not offer drag reorder.

## What the user should do

Nothing for new migrations. Profiles that already migrated can restore order with assistant-mode drag, or rerun V1 migration from Settings > Data (which discards current V2 data).

## Notes for release manager

Does not implement time-mode recency grouping (#18205), time-mode drag, or a post-migration rewrite of existing V2 rows.
