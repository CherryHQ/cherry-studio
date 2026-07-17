---
title: '"Data Reset" becomes "Factory Reset" and now actually erases everything'
category: changed
severity: breaking
introduced_in_pr: '#17138'
date: 2026-07-17
---

## What changed

Settings → Data → "Data Reset" is now "Factory Reset". It erases all app data on
the next restart — chats, assistants, knowledge bases, files, and all settings —
returning the app to a fresh-install state. Two things are deliberately kept:
the custom data directory location (if one was configured) and downloaded tool
binaries (uv, bun, etc.). The v1 button silently did almost nothing: it only
cleared part of the window state and left the database, files, and settings in
place while reporting success.

## Why this matters to the user

Anyone who previously used "Data Reset" expecting a light-weight cleanup will
now get a real, irreversible full wipe. The confirmation dialogs spell out the
consequences, and the wipe happens during the restart that follows confirmation.

## What the user should do

Back up (Settings → Data → Backup) before using Factory Reset. There is no way
to undo it afterwards.

## Notes for release manager

- On a machine that still has v1 data on disk, a factory reset behaves like a
  fresh install: the v1→v2 migration prompt will appear again on next start and
  can re-import the old v1 data. This mirrors fresh-install semantics (#17131).
- Log files are kept for diagnostics; they are not user content.
