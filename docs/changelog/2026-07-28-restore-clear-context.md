---
title: Clear context is restored in Home Chat
category: data-migration
severity: notice
introduced_in_pr: "#17524"
date: 2026-07-28
---

## What changed

Home Chat again supports starting a fresh model context inside the current conversation, from `Cmd/Ctrl+K`, the input QuickPanel, or an optional composer eraser button. The eraser is hidden by default and can be added through toolbar customization. The conversation keeps the visible history and shows a context-boundary divider, while later model requests exclude messages before the most recent boundary on the selected branch.

## Why this matters to the user

Users can reset what the model sees without creating a new conversation. Future v1-to-v2 migrations also preserve existing clear-context boundaries and their message-tree relationships.

## What the user should do

Use `Cmd/Ctrl+K` or choose Clear Context from the input QuickPanel. Add the eraser button from the composer toolbar customization menu if a persistent visible shortcut is preferred.

## Notes for release manager

Databases already migrated by an earlier v2 pre-release cannot reconstruct boundaries that were previously discarded. Those installations begin persisting new boundaries after this change.
