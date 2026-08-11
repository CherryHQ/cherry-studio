---
title: Overlapping Agent workspaces no longer block upgrade
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-08-11
---

## What changed

The v1-to-v2 migration now completes when an Agent filesystem target overlaps
a legacy Agent workspace. The conflicting target is preserved and its
filesystem copy is skipped while Agent, Session, and message database records
continue migrating.

## Why this matters to the user

Users with shared, nested, or linked legacy Agent workspace paths can finish
the upgrade. An affected Agent may be missing migrated identity, memory, or
managed workspace files, but the retained v1 workspace remains available. The
completed migration reports how many filesystem targets were skipped.

## What the user should do

After upgrading, check affected Agents and reselect or copy any missing
identity, memory, or workspace files from the retained v1 workspace.

## Notes for release manager

The migration warning contains only the skipped target count. Diagnostic logs
contain each skipped target and its overlapping source path.
