---
title: Composer toolbar tool shortcuts are customizable
category: changed
severity: notice
introduced_in_pr: "#16977"
date: 2026-07-14
---

## What changed

The persistent tool shortcut buttons on the chat and agent input composers are now user-customizable. This includes Chat's new-conversation action and Agent's new-task action, which stay first by default but can be unpinned. A "Customize toolbar" entry in the "+" panel opens a popover where each available tool can be pinned/unpinned via a switch and pinned tools can be drag-reordered; a "Restore default" button resets to the original set.

The chat toolbar's available shortcuts include MCP status, matching the agent toolbar. Actions pinned to the toolbar no longer appear again in the root "+" panel, while unpinned actions remain discoverable there.

## Why this matters to the user

Users will notice the input toolbar now reflects their own pinned selection instead of a fixed layout, without duplicating the same action in the root "+" panel. Defaults reproduce the previous persistent controls, so users who change nothing see no difference.

## What the user should do

Nothing — automatic. The default pinned set matches the previous behavior; customization is opt-in.

## Notes for release manager

Stored per surface in the `chat.input.toolbar.pinned_tools` / `agent.input.toolbar.pinned_tools` preferences (v2-only, no v1 source). Follow-up behavior completed in #17294.
