---
title: New agents default to Full Access
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-13
---

## What changed

The agent creation wizard now exposes the permission mode in the Basic Information step. New agents default to Full
Access (`bypassPermissions`), and the selected mode is saved when the agent is created.

## Why this matters to the user

A newly created agent can edit files, run commands, and use other tools without asking for approval unless the user
selects a more restrictive permission mode during creation. Existing agents keep their stored permission mode and are
unaffected.

## What the user should do

Review the permission mode while creating an agent. Choose Ask Before Acting or another restricted mode when tool
actions should require approval.

## Notes for release manager

This restores permission-mode selection in the v2 creation flow. The default is visible before creation and the Full
Access option retains its destructive styling and warning copy.
