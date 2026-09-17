---
title: Independent Agent session forks
category: changed
severity: notice
introduced_in_pr: 20340
date: 2026-09-10
---

## What changed

Pi, Claude and DSH offer **Fork** on completed assistant messages. Clicking validates
the native boundary and creates an independent Agent session. Incomplete messages
stay disabled; ordinary topic branches are unchanged.

Names use the next available suffix, such as `Session (1)`. Repeated forks advance
the number past matching names for the Agent instead of nesting suffixes.

## Why this matters to the user

The source keeps running. A fork retains history through the selected turn and
resumes independently, without queued messages, approvals, tasks or usage charges.
Deleting the source leaves published forks intact.

User workspaces remain shared; system workspaces copy current files without
restoring historical versions. Runtime context and compaction remain independent
of Chat compression settings.

## What the user should do

Choose **Fork**; no setup dialog is required. Missing identifiers or invalid native
history produce a specific error instead of a new session. If Claude has not yet
saved its transcript, retry after it finishes writing.

Retry if files change during a system-workspace copy. Coordinate edits in shared
user workspaces.

## Notes for release manager

Run the [fork verification matrix](../../../docs/references/testing/agent-session-fork.md)
for all three runtimes, including live resume, compaction metadata, restart recovery
and source deletion. Missing native history must fail explicitly; cleanup preserves
published sessions, adopted workspaces and files with uncertain ownership.
