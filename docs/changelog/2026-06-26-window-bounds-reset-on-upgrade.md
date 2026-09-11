---
title: Window position and size reset once on upgrade
category: data-migration
severity: notice
introduced_in_pr: #TBD
date: 2026-06-26
---

## What changed

The main window and the Quick Assistant window now remember their position and size through WindowManager's built-in bounds persistence (backed by the main-process persist cache) instead of the `electron-window-state` library. The old per-window state files (`window-state.json`, `quickAssistant-state.json`) are no longer read.

## Why this matters to the user

On the first launch after upgrading, both windows open at their default position and size once. From then on, position/size (and the main window's maximized state) are remembered across restarts as before, including restoring onto the display the window was last on.

## What the user should do

Nothing — this is automatic. The one-time reset is expected; the old state files are simply left behind (not migrated, not deleted) because window geometry is non-critical and regenerable.

## Notes for release manager

Pairs with the removal of the `electron-window-state` dependency and the new `rememberBounds` WindowManager capability. Only Main + QuickAssistant are affected this round.
