---
title: '"Data Reset" now actually erases everything'
category: changed
severity: breaking
introduced_in_pr: '#17138'
date: 2026-07-17
---

## What changed

Settings → Data → "Data Reset" keeps its v1 name and wording, but now actually
erases all app data on the next restart — chats, assistants, knowledge bases,
files, and all settings — returning the app to a fresh-install state. Three things are deliberately kept:
the custom data directory location (if one was configured), downloaded tool
binaries (uv, bun, etc.), and downloaded local models (the embedding / OCR
weights, which re-register themselves on next use). The v1 button silently did almost nothing: it only
cleared part of the window state and left the database, files, and settings in
place while reporting success.

## Why this matters to the user

Anyone who previously used "Data Reset" expecting a light-weight cleanup will
now get a real, irreversible full wipe. The confirmation dialogs spell out the
consequences, and the wipe happens during the restart that follows confirmation.

## What the user should do

There is no way to undo a data reset, and v2's built-in backup is not
available yet — the Settings → Data → Backup controls are currently disabled
(`BACKUP_V2_READY = false`). To keep a copy of your data, open the data
directory (Settings → Data → App Data → "Open Directory"), quit the app, and
copy that directory somewhere safe before running Data Reset.

## Notes for release manager

- v1 data does NOT come back after a data reset: the wipe erases the v1
  artifacts stored inside the data directory and the legacy
  `~/.cherrystudio/config` state, so the v1→v2 migration prompt will not
  reappear. Users who want their old data must restore from a backup.
- Log files and crash dumps are kept for diagnostics; they are not user content.
