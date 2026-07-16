---
title: Conversation and task lists change grouping and sorting
category: changed
severity: notice
introduced_in_pr: "#16998"
date: 2026-07-12
---

## What changed

The Time views for conversations and agent tasks now keep the pinned section followed by one stable creation-ordered list. The Today, Yesterday, This week, and Earlier groups and their expand/collapse controls have been removed; older unpinned rows load while scrolling. List options now separate display mode from item sorting, with choices for latest update, creation time, and manual order; both conversations and agent tasks default to creation time.

## Why this matters to the user

The default lists no longer change an existing item's position merely because it was updated. Users can scan one predictable newest-created-first list or choose another order without changing the order of the surrounding assistant, work-directory, or agent groups. Timestamp sorts show newest first, manual order enables item dragging, and newly pinned items appear first in their separate pinned section.

## What the user should do

Nothing is required. Choose a sort from the list options menu when a different item order is preferred.
