---
title: Transparent windows are enabled by default on macOS
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-24
---

## What changed

New installations and users without a saved window style now start with the transparent window appearance enabled on macOS. Existing saved window-style choices remain unchanged.

## Why this matters to the user

On macOS, the app shell uses the existing native vibrancy appearance from the first visible window. Windows continues to use its existing Mica or solid background behavior.

## What the user should do

Nothing — automatic. Users who prefer an opaque macOS window can turn off Transparent Window in Settings > Display & Language.

## Notes for release manager

The new default is stored on every platform, but the setting and transparent rendering path remain gated to macOS.
