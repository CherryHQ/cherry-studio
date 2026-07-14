---
title: Safer data directory selection
category: changed
severity: notice
introduced_in_pr: "#16874"
date: 2026-07-14
---

## What changed

Copying application data now requires a missing or empty destination. A non-empty destination can only be selected when it is recognized as an existing Cherry Studio data directory, in which case Cherry Studio switches to it without overwriting its files.

## Why this matters to the user

System folders and unrelated non-empty folders are rejected. Interrupted migration recovery also preserves directories that do not carry the matching migration ownership marker.

## What the user should do

Choose a new or empty folder when copying data. To reuse an existing Cherry Studio data directory, select that directory and confirm the switch without copying.

## Notes for release manager

This replaces the previous overwrite confirmation with a fail-safe, non-destructive selection model.
