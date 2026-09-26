---
title: Advanced View displays complete messages on a horizontal canvas
category: changed
severity: notice
introduced_in_pr: '#20212'
date: 2026-09-08
---

## What changed

The conversation branch entry is now named Advanced View and opens only as a maximized canvas, starting with the first message and branching outwards, beneath a single header with the topic title, sidebar toggle, assistant, and model selector. The canvas control bar switches its layout between left-to-right (default) and top-to-bottom, and remembers the choice. Message cards display the producing assistant's avatar, name, and model, plus Markdown content with streaming updates and a maximum height; longer messages scroll inside the card while its header and existing actions remain visible. Assistant cards expose a small continuation plus button, filled with the theme color and centered on the edge the branch leaves from; the node the conversation currently sits on is outlined in the same color. The minimap tints user and assistant messages across branches and keeps a visible viewport outline.

## Why this matters to the user

Users can read and operate on messages across branches without hovering for a preview. The first message stays vertically centered as its content loads, until the user interacts with the canvas or navigates to another message. Clicking a message card activates its conversation path, while the existing message actions operate on that message's own history. Empty nodes remain saved when users leave them, and clicking one restores it as the input target without clearing the composer draft.

## What the user should do

Nothing — automatic. Open Advanced View from the conversation toolbar and use the existing message actions and composer. Switch the canvas layout from the button in its bottom-left control bar. Close it to return to the conversation; a docked sidebar version is no longer available.
