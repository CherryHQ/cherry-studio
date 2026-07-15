---
title: Agent file previews can be edited in place
category: other
severity: notice
introduced_in_pr: "#17044"
date: 2026-07-15
---

## What changed

The Agent right panel can now switch text files up to 2 MB between preview and edit modes, save changes, or discard a draft. File loading and saving reuse the same existing filesystem capabilities as the Notes editor.

## Why this matters to the user

Users can make small changes to generated code and text without leaving Cherry Studio. Drafts stay local until they are saved; closing the file or opening another one asks before discarding unsaved changes and then clears the draft.

## What the user should do

Nothing - this is automatic. Binary files and files larger than 2 MB remain preview-only and can still be opened in an external editor.
