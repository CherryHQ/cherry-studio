---
title: Agent file previews can be edited in place
category: other
severity: notice
introduced_in_pr: TBD
date: 2026-07-15
---

## What changed

The Agent right panel can now switch supported text files between preview and edit modes, save changes, or discard a draft. Editing is available for regular UTF-8 text files up to 2 MB with consistent line endings.

## Why this matters to the user

Users can make small changes to generated code and text without leaving Cherry Studio. If the agent or another application changes the file after editing begins, Cherry Studio keeps the draft and asks before reloading instead of silently overwriting the newer file.

## What the user should do

Nothing - this is automatic. Files with unsupported encodings, mixed line endings, symbolic links, and larger files remain preview-only and can still be opened in an external editor.
