---
title: macOS page side panels now scope to the active tab content area
category: changed
severity: notice
introduced_in_pr: '#16555'
date: 2026-06-29
---

## What changed

On macOS, `PageSidePanel` (the page-owned settings / detail drawers — translate,
model, knowledge, and mini-app settings) now portals into the active route tab's
content root and positions `absolute` within it, the same as Windows/Linux.
Previously on macOS it portaled to `document.body` with `fixed` positioning, so
the panel and dimmed backdrop covered the whole window.

## Why this matters to the user

On macOS the dimmed backdrop now covers only the page content area, not the
sidebar and tab bar:

- The sidebar and tab bar stay interactive while a panel is open, and clicking
  them no longer dismisses the panel through the backdrop. Escape, the close
  button, and clicking the content-area backdrop still close it.
- A still-open panel now stays with its owning tab when you switch tabs instead
  of bleeding over the newly active tab.

Windows/Linux already behaved this way (since #16074); this only aligns macOS
with them.

## What the user should do

Nothing — automatic.

## Notes for release manager

Intra-v2 refinement: #16074 deliberately left macOS on the old full-window
`document.body` portal ("scope non-mac app shell portal"); this PR unifies all
platforms onto the per-tab `PortalContainerProvider`, so the panel now matches
the tab-scoped Radix overlays (popover / dropdown / etc.). Safe to merge with
any other PageSidePanel notices at release.
