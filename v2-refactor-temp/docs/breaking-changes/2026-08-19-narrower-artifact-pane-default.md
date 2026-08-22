---
title: "File and artifact panes open narrower by default"
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-19
---

## What changed

The shared Chat and Agent file/artifact pane now opens at 280 px instead of 460 px. Existing profiles that still
carry the historical 460 px value receive this change once; other saved widths are preserved.

## Why this matters to the user

Opening the pane leaves more room for the conversation, especially in narrower windows.

## What the user should do

Nothing in most cases. If you intentionally set the pane to exactly 460 px before upgrading, resize it once after
upgrading; that later choice is preserved.

## Notes for release manager

The resizable range remains 255–720 px. A version marker makes the ambiguous 460→280 transition run only once, so
users can subsequently resize the pane back to 460 px without another reset.
