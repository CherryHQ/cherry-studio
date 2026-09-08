---
title: Advanced View displays complete messages on a horizontal canvas
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-08
---

## What changed

The conversation branch entry is now named Advanced View and opens only as a maximized canvas, starting with the first message on the left and branching to the right, beneath a single header showing the topic title. Message cards display the producing assistant's avatar, name, and model, plus Markdown content with streaming updates and a maximum height; longer messages scroll inside the card while its header and existing actions remain visible. The minimap uses stronger node contrast and a visible viewport outline.

## Why this matters to the user

Users can read and operate on messages across branches without hovering for a preview. Clicking a message header retains the existing branch selection behavior; editing and retrying use the selected message's own history. Empty branches remain available for continued input.

## What the user should do

Nothing — automatic. Open Advanced View from the conversation toolbar and use the existing message actions and composer. Close it to return to the conversation; a docked sidebar version is no longer available.
