---
title: Advanced View displays complete messages on a horizontal canvas
category: changed
severity: notice
introduced_in_pr: '#20212'
date: 2026-09-08
---

## What changed

The conversation branch entry is now named Advanced View and opens only as a maximized canvas, starting with the first message on the left and branching to the right, beneath a single header with the topic title, sidebar toggle, assistant, and model selector. Message cards display the producing assistant's avatar, name, and model, plus Markdown content with streaming updates and a maximum height; longer messages scroll inside the card while its header and existing actions remain visible. Assistant cards expose a small continuation plus button centered on their right edge, and the minimap uses distinct colors for user and assistant messages across branches with a visible viewport outline.

## Why this matters to the user

Users can read and operate on messages across branches without hovering for a preview. Clicking a message card activates its conversation path, while the existing message actions operate on that message's own history. Empty nodes remain saved when users leave them, and clicking one restores it as the input target without clearing the composer draft.

## What the user should do

Nothing — automatic. Open Advanced View from the conversation toolbar and use the existing message actions and composer. Close it to return to the conversation; a docked sidebar version is no longer available.
