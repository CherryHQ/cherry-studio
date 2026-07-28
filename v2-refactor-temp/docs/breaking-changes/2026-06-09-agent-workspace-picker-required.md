---
title: Agent creation flows require workspace selection before they are enabled
category: changed
severity: breaking
introduced_in_pr: #15736
date: 2026-06-09
---

## What changed

Agent session creation, input-bar session creation, scheduled task creation, and channel creation now require an explicit workspace source. Until the workspace picker UI is wired, those create entry points are disabled rather than creating records with an implicit or missing workspace.

Migrated scheduled tasks currently carry a system workspace source. Heartbeat schedules need a user workspace with `heartbeat.md`, so migrated heartbeat tasks skip until the user creates or updates them with a user workspace.

## Why this matters to the user

Users cannot create new agent sessions, agent tasks, or agent channels from the affected entry points until workspace selection is available. Users with migrated heartbeat tasks may see those tasks remain enabled but do no work.

## What the user should do

TBD. Once the workspace picker lands, select a user workspace for new sessions, tasks, and channels. Recreate or update migrated heartbeat tasks with a user workspace that contains `heartbeat.md`.

## Notes for release manager

If the workspace picker ships in the same release train before v2.0.0, collapse this note into the workspace-selection release note or drop the disabled-entry wording.
