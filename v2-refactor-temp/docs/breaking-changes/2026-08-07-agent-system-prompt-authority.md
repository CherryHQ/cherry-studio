---
title: Agent System Prompt is now authoritative
category: changed
severity: notice
introduced_in_pr: '#18100'
date: 2026-08-07
---

## What changed

The System Prompt saved in Agent configuration now has explicit priority over workspace `system.md` instructions and the Agent's `SOUL.md` persona when they conflict. Agent editing also exposes the same System Prompt variables and preview affordances as Assistant editing.

## Why this matters to the user

Changes made in the Agent System Prompt field take effect from the next fresh model turn and define the Agent's role. Existing workspace instructions and persona continue to provide non-conflicting local guidance, personality, and tone.

## What the user should do

Nothing — the change is automatic. Existing custom `SOUL.md` and workspace files are preserved and are not migrated or overwritten.

## Notes for release manager

Agent variables are resolved when the Claude Code connection is created or rebuilt. A response already in progress keeps its original prompt snapshot.
