---
title: macOS 12 is no longer supported, and file pickers now open in Downloads
category: platform
severity: breaking
introduced_in_pr: "#19350"
date: 2026-09-07
---

## What changed

The app now runs on Electron 44 (Chromium 152) instead of Electron 41 (Chromium 146). **macOS 12 (Monterey) is no longer supported** — the packaged app declares macOS 13 (Ventura) as its minimum and will not launch below it. Three runtime defaults also changed: file pickers that do not request a specific folder now open in Downloads instead of the last folder browsed, frameless windows on Linux now have rounded corners, and the Linux window controls follow the desktop environment's native title bar layout.

## Why this matters to the user

A user still on macOS 12 cannot run this version at all — macOS refuses to launch the app rather than showing an in-app message, so the failure looks like the app is broken. Everyone else notices the file-picker change: adding an attachment, choosing a knowledge base folder, or saving an export starts in Downloads every time rather than returning to wherever they last browsed. On Linux, windows change shape slightly and the window buttons may move to the other side of the title bar or reduce to just a close button — GNOME shows only close by default, and right-to-left systems place the controls on the left.

## What the user should do

macOS 12 users must upgrade to macOS 13 or later to keep receiving updates; the last release supporting Monterey remains installable. Everyone else: nothing — automatic.

## Notes for release manager

The macOS 12 drop is the item that needs to be prominent in the release note and ideally announced ahead of the release — it is the only change here a user cannot work around inside the app.

The Downloads default comes from Electron itself, not from a Cherry Studio setting, so there is no toggle to offer. If users complain, the fix is to track the last-used directory per dialog in the app — worth deciding before release rather than after.

Three further runtime changes are deliberately not listed above because they do not affect users of official builds: macOS notifications now require a code-signed app (signed release builds are unaffected; only unsigned local dev builds lose notifications), Electron dropped Unity desktop integration on Linux (we never called the removed API), and Electron stopped publishing 32-bit Windows and ARMv7 Linux binaries (we already ship only 64-bit).
