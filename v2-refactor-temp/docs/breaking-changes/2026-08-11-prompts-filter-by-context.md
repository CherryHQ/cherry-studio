---
title: Quick phrases now default to the current Assistant or Agent
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-11
---

## What changed

The quick-phrase picker now shows prompts linked to the current Assistant or Agent by default. All global prompts remain available through a separate “All prompts” entry, and the existing management dialog can link or unlink prompts for the current context.

## Why this matters to the user

Users with large prompt libraries will see a shorter, context-specific list in conversations and Agent sessions. Prompts created from a conversation are saved globally and linked to that conversation's Assistant or Agent; prompts created from the management dialog or painting composer remain global only.

## What the user should do

Nothing — automatic. Existing v2 prompts remain available under “All prompts” and can be linked from the management dialog. A direct v1-to-v2 migration preserves Assistant quick-phrase links when the source relationship is available.

## Notes for release manager

Users who already completed the v2 migration cannot have old Assistant relationships reconstructed reliably; their prompts remain global and may need to be linked manually.
