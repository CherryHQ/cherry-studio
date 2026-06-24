---
title: Deleting a workspace deletes its sessions
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

Deleting a workspace from the agent session workspace view now deletes the
workspace row and all sessions under that workspace. The actual folder on disk
is not deleted.

## Why this matters to the user

Users who delete a workspace group from the sessions list will also remove the
sessions shown under that workspace group, instead of only detaching those
sessions from the workspace.

## What the user should do

Nothing automatic is required. Before confirming a workspace delete, make sure
the sessions under that workspace are no longer needed.

## Notes for release manager

The confirmation dialog in the app explains that only database records are
removed and the real folder remains on disk.
