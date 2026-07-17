---
title: Assistant tags are migrated as groups
category: data-migration
severity: notice
introduced_in_pr: "#17109"
date: 2026-07-16
---

## What changed

Each v1 assistant's optional tag is migrated to a v2 assistant group. Assistant organization now uses group wording and one group per assistant, and no longer assigns or displays tag colors.

## Why this matters to the user

Users keep the same assistant organization after upgrading, including the saved group order. Assistant group chips are neutral and an assistant can belong to only one group.

## What the user should do

Nothing — automatic.

## Notes for release manager

V1 assistant data stores at most one tag name per assistant. Unused tag names are not migrated because they do not organize any assistant.
