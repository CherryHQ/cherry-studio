---
title: '"Data Reset" now actually erases the app data directory'
category: changed
severity: breaking
introduced_in_pr: '#17138'
date: 2026-07-17
---

## What changed

Settings → Data → "Data Reset" keeps its v1 name and wording, but now actually
erases the app's data on restart — chats, assistants, knowledge bases, files,
settings, and browsing/login state (cookies, IndexedDB, local storage) —
returning the app to a fresh-install state. The v1 button silently did almost
nothing: it only cleared part of the window state and left the database,
files, and settings in place while reporting success.

The wipe is a whitelist over the app data directory: only entries Cherry (or
its embedded Chromium) is known to own are deleted. Anything else in that
directory — user files, artifacts from other tools — is never touched.

Deliberately kept:

- the custom data directory **location** (if one was configured) — the reset
  wipes the data at that location, not the choice of location;
- downloaded machine artifacts: tool binaries (uv, bun, …), local model
  weights (embedding / OCR), and the OCR language data. This PR only preserves
  those files; it deliberately does not reconcile or repair local-model state
  after the database reset;
- log files and crash dumps (diagnostics, not user content);
- everything under `~/.cherrystudio` (see below).

## Why this matters to the user

- Anyone who previously used "Data Reset" expecting a light-weight cleanup
  will now get a real, irreversible wipe of their app data. The confirmation
  dialogs spell out the consequences.
- The app restarts twice: once to perform the wipe (which runs before the app
  boots, so no files are in use), and once more into the fresh state.
- `~/.cherrystudio` is deliberately NOT touched (maintainer decision:
  safety over thoroughness). It is machine-level domain — tool binaries,
  model runtimes, MCP OAuth state, GitHub Copilot credentials, and the
  `boot-config.json` boot settings. Users who want those credentials gone
  must remove `~/.cherrystudio` manually after the reset.

## What the user should do

There is no way to undo a data reset, and v2's built-in backup is not
available yet — the Settings → Data → Backup controls are currently disabled
(`BACKUP_V2_READY = false`). To keep a copy of your data, open the data
directory (Settings → Data → App Data → "Open Directory"), quit the app, and
copy that directory somewhere safe before running Data Reset.

## Notes for release manager

- v1 data does NOT come back after a data reset for the normal install: the
  wipe erases the v1 artifacts stored inside the data directory (including
  `version.log`, whose presence alone would re-trigger v1 detection).
- Edge case: a machine that ALSO has v1 data outside the data directory (a
  legacy custom path recorded in `~/.cherrystudio/config`, which the reset
  keeps) can see the v1→v2 migration prompt again on the boot after the
  reset — the app treats itself as a fresh install and re-runs legacy
  detection. Migrating again or declining are both safe.
- If the wipe hits locked files (antivirus, indexer), it retries once via an
  automatic relaunch; if files remain locked it gives up, tells the user what
  happened, and starts with whatever remains — running Data Reset again later
  finishes the job.
