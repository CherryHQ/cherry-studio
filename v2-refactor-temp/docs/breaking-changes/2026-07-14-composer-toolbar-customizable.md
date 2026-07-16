---
title: Composer toolbar tool shortcuts are customizable
category: changed
severity: notice
introduced_in_pr: "#16977"
date: 2026-07-14
---

## What changed

The persistent tool shortcut buttons on the chat and agent input composers (previously a fixed set — reasoning + web search on chat, reasoning + skills on agent) are now user-customizable. A "Customize toolbar" entry in the "+" panel opens a popover where each available tool can be pinned/unpinned via a switch and pinned tools can be drag-reordered; a "Restore default" button resets to the original set.

## Why this matters to the user

Users will notice the input toolbar now reflects their own pinned selection instead of a fixed layout. Unpinned tools are still reachable from the "+" panel. Defaults reproduce the previous fixed bars exactly, so users who change nothing see no difference.

## What the user should do

Nothing — automatic. The default pinned set matches the previous behavior; customization is opt-in.

## Notes for release manager

Stored per surface in the `chat.input.toolbar.pinned_tools` / `agent.input.toolbar.pinned_tools` preferences (v2-only, no v1 source).
