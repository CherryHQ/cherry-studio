---
title: Assistant tags are migrated as groups
category: data-migration
severity: notice
introduced_in_pr: #TBD
date: 2026-07-16
---

## What changed

Each v1 assistant's optional tag is migrated to a v2 assistant group. The existing tag wording remains in the interface, but assistant organization now uses one group per assistant and no longer assigns or displays tag colors.

## Why this matters to the user

Users keep the same assistant organization after upgrading, including the saved group order. Assistant tag chips are now neutral and an assistant can belong to only one group.

## What the user should do

Nothing — automatic.

## Notes for release manager

V1 assistant data stores at most one tag name per assistant. Unused tag names are not migrated because they do not organize any assistant.
