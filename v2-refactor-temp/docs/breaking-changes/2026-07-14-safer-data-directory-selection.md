---
title: Safer data directory selection
category: changed
severity: notice
introduced_in_pr: "#16874"
date: 2026-07-14
---

## What changed

Copying application data now requires a missing or empty destination. Selecting any non-empty destination switches to it without copying or overwriting its files.

## Why this matters to the user

Protected application trees and system directory roots are rejected, while writable subdirectories below system locations remain available. Interrupted migration recovery also preserves directories that do not carry the matching migration ownership marker.

## What the user should do

Choose a new or empty folder when copying data. To use a non-empty directory as-is, select it and confirm the switch without copying.

## Notes for release manager

This replaces the previous overwrite confirmation with a fail-safe, non-destructive selection model.
