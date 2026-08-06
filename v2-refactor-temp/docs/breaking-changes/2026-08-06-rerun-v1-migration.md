---
title: v1 migration can be run again
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-08-06
---

## What changed

Settings > Data now offers a rerun-migration action when retained v1 Redux data is detected. The action discards the current v2 data, then restarts into the existing migration flow.

## Why this matters to the user

Users who need to recover data missed by an earlier v1 migration can migrate from their retained v1 sources again. Current v2 data is discarded, so a three-step wizard requires explicit risk acknowledgement, offers a full-backup shortcut, and asks for final confirmation.

## What the user should do

Create a full backup if the current v2 data may be needed, review the warning, then confirm the rerun from Settings > Data.

## Notes for release manager

The entry is shown only when the exact `persist:cherry-studio` Local Storage key exists. Original v1 browser and filesystem sources are preserved for the next migration.
