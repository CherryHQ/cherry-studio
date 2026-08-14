---
title: Message right-click menu now appears with disabled items when no text is selected
category: changed
severity: notice
introduced_in_pr: '#12060'
date: 2026-05-11
---

## What changed

Right-clicking inside the chat message area, citations, and agent session
messages now always shows the "Copy" / "Quote" context menu. Previously the
menu was only opened when there was an active text selection. The items are
disabled when nothing is selected, so the menu is discoverable but inert.

## Why this matters to the user

Before this change, right-clicking on plain (non-selected) message text did
nothing. After this change, the menu shows up but both actions appear greyed
out until the user selects some text. The eventual behavior of "Copy" /
"Quote" once a selection exists is unchanged.

## What the user should do

Nothing — automatic. The change is purely additive (discoverability) and the
keyboard / clipboard behavior of a real selection is identical to v1.

## Notes for release manager

Renamed `ContextMenu` (the selection-aware wrapper) to `SelectionContextMenu`
internally — no user-visible impact, just call out if release notes ever
reference component names.
