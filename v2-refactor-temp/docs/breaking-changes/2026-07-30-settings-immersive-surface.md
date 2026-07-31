---
title: Settings now opens as an immersive application surface
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-30
---

## What changed

Settings no longer opens as a workspace tab. It now temporarily replaces the workspace chrome with a dedicated Settings surface and a Back action.

## Why this matters to the user

Opening Settings hides the workspace tab strip and global sidebar, but it no longer adds or repurposes tabs. Returning from Settings restores the workspace and its previously active tab.

## What the user should do

Nothing — automatic. Use Back in the Settings title bar to return to the workspace.

## Notes for release manager

The title bar intentionally has no visible Settings title. On macOS, Back follows the traffic-light area; on Windows and Linux, it appears at the top left.
