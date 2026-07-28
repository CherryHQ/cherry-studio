---
title: Sidebar toggle shortcuts split into left / right
category: shortcut
severity: notice
introduced_in_pr: 15699
date: 2026-06-01
---

## What changed

The single "Toggle Sidebar" and "Toggle Topics" shortcuts are replaced by "Toggle Left Sidebar" (Cmd/Ctrl+`[`) and "Toggle Right Sidebar" (Cmd/Ctrl+`]`), now listed under the Topic group in Settings → Shortcuts. The default key bindings are unchanged.

## Why this matters to the user

In Settings → Shortcuts the entries are relabeled to "Toggle Left Sidebar" / "Toggle Right Sidebar". The right-side shortcut (Cmd/Ctrl+`]`) now toggles the v2 right-side pane instead of the old topics list. Users who customized the old shortcuts keep their bindings: v1 `toggle_show_assistants` / `toggle_sidebar` migrate to the left shortcut, `toggle_show_topics` migrates to the right shortcut.

## What the user should do

Nothing — automatic. Bindings are preserved through migration.

## Notes for release manager

- Bindings are unchanged from v1; this is essentially a relabel plus the right shortcut now targeting the v2 right pane.
- Do NOT describe any "topic sidebar auto-opens" change — that behavior was lost earlier in the chat-page UI refactor (the `MainSidebar` listener for `SHOW_TOPIC_SIDEBAR` was removed) and is unrelated to this shortcut work.
- `introduced_in_pr` is TBD — fill with the feat/chat-page PR number (or commit hash) when committed.
