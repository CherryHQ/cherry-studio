---
title: "File and artifact panes open narrower by default"
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-19
---

## What changed

The shared Chat and Agent file/artifact pane now opens at 280 px instead of 460 px when no custom width is saved.

## Why this matters to the user

Opening the pane leaves more room for the conversation, especially in narrower windows.

## What the user should do

Nothing — the new default applies automatically unless the pane was manually resized.

## Notes for release manager

The resizable range remains 255–720 px, and an explicitly saved width is preserved.
