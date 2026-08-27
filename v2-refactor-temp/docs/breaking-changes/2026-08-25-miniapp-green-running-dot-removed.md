---
title: Mini-app "running" dot removed; hiding a mini app now closes it
category: removed
severity: notice
introduced_in_pr: '#19395'
date: 2026-08-25
---

## What changed

The green dot on launchpad / mini-app tiles is gone. Hiding a mini app (tile context menu, or the Settings visibility lists) now also closes it: its background webview is destroyed and its audio stops.

## Why this matters to the user

The dot meant "resident in the keep-alive pool", which users read as "still open" and could not turn off. Open mini apps are now represented by their tabs only. A hidden app that was still loaded in the background used to keep running with no tile left to reach it; it now exits, so reopening it after unhiding starts a fresh load.

## What the user should do

Nothing — automatic. To close a mini app, close its tab.

## Notes for release manager

Pairs with the tab-close exit behavior already shipped in #16788 (closing a mini-app tab destroys its webview).
