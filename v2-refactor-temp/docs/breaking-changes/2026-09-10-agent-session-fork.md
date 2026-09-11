---
title: Independent Agent session forks
category: changed
severity: notice
introduced_in_pr: N/A (uncommitted implementation)
date: 2026-09-10
---

## What changed

Pi, Claude and DSH assistant menus can create an independent Agent session from
a completed turn, preferring a supported native checkpoint. Ordinary topic branches
are unchanged.

Forked names receive an available numeric suffix, for example `Session (1)` and
`Session (2)`. Forking a child increments the existing trailing number instead of
appending another suffix, continuing after the highest matching number for the Agent.

## Why this matters to the user

The source can continue running. New sessions do not inherit queued messages,
approvals, running tasks or usage charges. User directories remain shared;
system directories copy current files, not historical versions.

## What the user should do

No manual migration is required. Valid checkpoints fork directly without a dialog.
Completed older messages without a valid checkpoint require confirmation before
rebuilding context from saved history. The short prompt only explains reconstruction. The full
history stays visible while model input reuses a verified compacted prefix or
prepares a fresh summary before first send. Compression may incur model usage
and may omit details. Missing configuration or insufficient context budget stops
submission rather than silently sending the full transcript. Reattach files when needed.
If files change while copying, retry; incomplete turns remain unavailable.

Fork context details are not shown in the right pane; preparation and audits
continue in the background. If a native
send result cannot be confirmed, inspect runtime history before retrying; the app
does not automatically inject the same historical context again. Migration 0022
adds per-session context snapshots and receipts; deleting a parent leaves child
snapshots independent.

## Notes for release manager

Confirm all three live runtime resume paths and the manual matrix in the Agent
Session Fork Verification reference before release. Claude SDK compaction and
replacement limitations reject native restoration and use disclosed history reconstruction.
