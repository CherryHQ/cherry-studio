---
title: Independent Agent session forks
category: changed
severity: notice
introduced_in_pr: #20340
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

DSH forks keep their own tool and approval identity while the source is running.
Reads and new-file writes in the copied workspace are not blocked by a source
write; ordinary permissions and non-bypassable safety checks still apply.

Native DSH `write`/`edit` calls now reject competing writes to the same file across
sessions. Existing files must be read before modification, and stale versions require
a fresh read. Reads and writes to independent files remain concurrent. This protection
also covers Pi and Claude built-in file writers (without adding read-before-write
rules to those runtimes). It does not cover shell commands, MCP tools, external editors or separate
app instances; it is not an operating-system file lock.

## What the user should do

No manual migration is required. Valid checkpoints fork directly without a dialog.
Completed older messages without a valid checkpoint automatically rebuild context
from saved history without a confirmation dialog. The full
history stays visible while model input reuses a verified compacted prefix or
prepares a fresh summary before first send. Compression may incur model usage
and may omit details. Missing configuration or insufficient context budget stops
submission rather than silently sending the full transcript. Reattach files when needed.
If files change while copying, retry; incomplete turns remain unavailable.

On a native file-write conflict, wait for the writer to finish and read the file again
before merging changes. Do not bypass the conflict using shell commands. Coordinate
non-participating writers or use separate working copies. Restart the development
runtime to load the updated host and bridge together.

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

## Fork recovery hardening

Context JSON v2 retains successful send receipts while invalidating old native
summaries without capture proofs. Initialization tokens are not delivery receipts.
Uncertain sends or missing required native history stop for reconciliation instead
of creating an empty conversation or injecting history again.

Journal v2 coordinates cleanup with workspace registration. Adopted copied
directories are retained permanently; uncertain ownership and legacy cleanup
records preserve files. No new SQL table or change to a released migration is required.
