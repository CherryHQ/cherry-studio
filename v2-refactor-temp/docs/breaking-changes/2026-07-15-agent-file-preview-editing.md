---
title: Agent file previews can be edited in place
category: other
severity: notice
introduced_in_pr: "#17044"
date: 2026-07-15
---

## What changed

The Agent right panel can now switch text files up to 2 MiB between preview and edit modes, then save or discard changes.

## Why this matters to the user

Users can make small changes to generated code and text without leaving Cherry Studio. If a draft has unsaved changes, closing the preview or opening another file asks for confirmation before clearing it.

## What the user should do

Nothing — this is automatic. Binary files and files larger than 2 MiB remain non-editable in the preview pane and can still be opened in an external app.

## Notes for release manager

Saving does not detect changes made by another application after the file was loaded.
