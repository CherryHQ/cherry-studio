---
title: File pickers open in Downloads, and Linux window frames follow the desktop
category: changed
severity: notice
introduced_in_pr: "#19350"
date: 2026-09-07
---

## What changed

The app now runs on Electron 43 (Chromium 150) instead of Electron 41 (Chromium 146). Three of the runtime's own default behaviors changed with it: file pickers that do not request a specific folder now open in Downloads instead of the last folder browsed, frameless windows on Linux now have rounded corners, and the Linux window controls (minimize, maximize, close) now follow the desktop environment's native title bar layout.

## Why this matters to the user

Picking an attachment, choosing a knowledge base folder, or saving an export starts in Downloads every time rather than returning to wherever the user last browsed. This is most noticeable for anyone who repeatedly adds files from one deep folder. On Linux, windows change shape slightly, and the window buttons may move to the other side of the title bar or reduce to just a close button, depending on the desktop environment — GNOME, for example, shows only close by default, and right-to-left systems place the controls on the left.

## What the user should do

Nothing — automatic. Saving a file still defaults to a sensible filename; only the starting folder changed.

## Notes for release manager

The Downloads default comes from Electron itself, not from a Cherry Studio setting, so there is no toggle to offer. If users complain, the fix is to track the last-used directory per dialog in the app — worth deciding before release rather than after.

Two related runtime changes are deliberately not listed above because they do not affect users of official builds: macOS notifications now require a code-signed app (signed release builds are unaffected; only unsigned local dev builds lose notifications), and Linux packaging now depends on a rebuilt `better-sqlite3` prebuild for the new native ABI.
