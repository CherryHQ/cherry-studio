---
title: Agent file previews can be edited in place with autosave
category: other
severity: notice
introduced_in_pr: "#17044"
date: 2026-07-15
---

## What changed

The Agent right panel can switch UTF-8 text files up to 2 MiB between preview
and edit modes. Edits **autosave** (debounced) as you type — there are no Save
or Discard buttons, and closing the preview or switching files no longer asks
for confirmation because there is nothing unsaved. The Notes editor shares the
same save pipeline and gains the same protections.

If the file changes on disk outside the editor and collides with local edits, a
"File changed on disk" dialog offers **Reload** (discarding the in-progress
edit); dismissing it keeps the draft in the editor with autosave paused until
reload. If autosave fails (disk full, permissions), the edit stays in the
editor, a toast warns, saving retries on the next keystroke, and navigation away
from the unsaved draft is blocked.

## Why this matters to the user

Users can make small changes to generated code and text without leaving Cherry
Studio, and edits persist automatically. Binary files, files over 2 MiB,
non-UTF-8 encodings, and mixed line endings remain preview-only (in Notes such
files show a load-failure state instead of an editable blank page).

## What the user should do

Nothing — this is automatic. To abandon an edit after an external change, use
**Reload file** in the conflict dialog.

## Notes for release manager

Writes go through an optimistic version+hash check (`file.write_if_unchanged`);
a stale write is verified against disk before surfacing the conflict dialog.
UTF-8 BOM and uniform LF/CRLF line endings are preserved byte-for-byte.
