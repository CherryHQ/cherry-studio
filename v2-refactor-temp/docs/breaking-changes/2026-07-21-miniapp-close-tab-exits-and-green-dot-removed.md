---
title: 'Mini-app: closing the tab now truly exits the app; the green "running" dot is removed'
category: changed
severity: notice
introduced_in_pr: "#17235"
date: 2026-07-21
---

## What changed

**Changed**: explicitly closing a mini-app tab (close button, "close others",
"close all", or dragging the tab out into its own window — from the source
window's perspective) now truly exits the mini app: its background webview is
destroyed and its memory released. Previously the webview silently stayed
alive in the keep-alive pool until app restart.

**Removed**: the green "running" dot on mini-app icons in the launchpad grid.
It signaled "still resident in the keep-alive pool", which users read as
"still open" — after a tab was closed it stayed lit with no way to turn it
off (the original complaint).

**Kept**: switching away keeps apps alive. Moving to another tab, or
navigating the same tab elsewhere via the sidebar, still preserves the
mini app's state for an instant return — bounded by the existing keep-alive
cap (default 3, LRU-evicted).

## Why this matters to the user

- Closing a mini-app tab that is playing audio/video now stops the sound —
  before, it kept playing with no way to stop it.
- Reopening a mini app after closing its tab reloads it from scratch instead
  of restoring instantly. Switching between open tabs is unaffected.
- The launchpad no longer shows a green dot on opened apps; open mini apps
  are represented by their tabs in the tab bar.

## What the user should do

Nothing required. Users who want a mini app to stay loaded should keep its
tab open (pinning the tab additionally exempts it from LRU eviction).

## Notes for release manager

The dormant one-off popup state (`mini_app.opened_oneoff`, `mini_app.show`)
from the v1 popup era was removed along with its API surface
(`closeMiniApp`, `closeAllMiniApps`, `hideMiniAppPopup`, `openMiniAppById`) —
all had zero production callers. Both were window-local memory caches, so no
data migration is involved.
