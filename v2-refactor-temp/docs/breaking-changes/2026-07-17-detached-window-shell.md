---
title: Detached pages now use integrated window chrome
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-17
---

## What changed

Detached Chat and Agent pages now merge their tab title and window actions into the page navbar. Other detached pages use a framed content surface, and newly detached windows appear immediately at the release position.

## Why this matters to the user

Detached windows have more usable vertical space, follow the active macOS window material, and no longer remain hidden or appear away from the pointer after a quick drag-release.

## What the user should do

Nothing — automatic.

## Notes for release manager

The window-material changes are specific to transparent macOS windows; Windows and Linux retain opaque surfaces and custom window controls.
