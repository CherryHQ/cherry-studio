---
title: Right-side conversation lists now open by default
category: changed
severity: notice
introduced_in_pr: "#17132"
date: 2026-07-16
---

## What changed

In the classic Chat and Agent layouts, placing conversations or tasks on the right now opens both the left owner rail and the right list by default. The minimum widths are now 200 px for the left rail and 255 px for the right pane.

## Why this matters to the user

Existing v2 environments will have their cached right-pane open/closed choice reset once because the previous cache could not distinguish the old system default from an explicit manual close. After that reset, new manual open/closed choices continue to persist independently for Chat and Agent.

## What the user should do

Nothing — automatic. Close either right pane again if it should remain closed on later visits.

## Notes for release manager

The v1 branch does not persist these v2-only pane keys, so no user-state migration is required.
