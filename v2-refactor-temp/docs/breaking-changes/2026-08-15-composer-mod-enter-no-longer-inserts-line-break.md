---
title: The message input line break is now a configurable shortcut
category: shortcut
severity: notice
introduced_in_pr: '#18642'
date: 2026-08-15
---

## What changed

The chat, agent, and painting message inputs used to insert a line break on `Enter`, `Shift+Enter`, and `Cmd/Ctrl+Enter` alike. Line breaks now use one configurable shortcut (Settings > Chat > Input > Line break shortcut, default `Shift+Enter`), and send / line break / steer must each use a different key. `Cmd/Ctrl+Enter` is free by default and becomes the steer shortcut: while an agent is running, it sends the draft into the current turn instead of queueing it.

## Why this matters to the user

Users who insert line breaks with `Cmd/Ctrl+Enter` will find the key no longer does so — in an agent session it now steers the running turn. Enter combinations that are not bound to send, line break, or steer do nothing at all instead of inserting a break.

The three shortcuts also moved to the app's shared key vocabulary, so their labels now match Settings > Shortcuts (`⌘Enter` rather than `⌘ + Enter`). On Windows and Linux the send shortcut loses its `Win/Super+Enter` option, which was reserved by the OS and could never fire; anyone who had selected it now sends with `Ctrl+Enter`.

## What the user should do

Nothing — automatic. `Shift+Enter` keeps working as the line break. To restore `Cmd/Ctrl+Enter`, set it as the line break shortcut in Settings > Chat > Input.
