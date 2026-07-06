---
title: Agent skill toggles in the edit dialog now apply on Save
category: changed
severity: notice
introduced_in_pr: "#16781"
date: 2026-07-06
---

## What changed

In the agent edit dialog (Tools → Skills tab), flipping a skill switch no longer takes effect immediately. Skill changes are now staged in the dialog and applied together when the user clicks Save; closing or cancelling the dialog discards them.

## Why this matters to the user

Previously each skill switch wrote through instantly, even if the user then cancelled the dialog. Now the Skills tab behaves like every other field in the dialog: nothing changes until Save. Users who relied on toggling a skill and dismissing the dialog without saving will find the toggle reverted.

## What the user should do

Click Save after changing skills in the agent edit dialog.

## Notes for release manager

Saving replaces the agent's enabled-skill set wholesale (last write wins). Skill enablement changed elsewhere while the dialog is open — e.g. by an agent's MCP skill tool or by a newly installed built-in skill being auto-enabled — is overwritten on Save.
