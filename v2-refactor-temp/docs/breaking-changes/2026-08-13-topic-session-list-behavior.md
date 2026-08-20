---
title: Conversation and agent session lists use continuous paging and explicit sorting
category: changed
severity: notice
introduced_in_pr: "#16998"
date: 2026-08-13
---

## What changed

Flat Conversation and Agent Session views now show a pinned section followed by one continuously paged list instead
of Today, Yesterday, This week, and Earlier buckets. Ordinary rows can be sorted by creation time, activity time, or
manual order; both lists default to creation time.

Deleting the last conversation or task in a group now leaves that group empty. Clearing a group or deleting its
assistant or agent also stops creating a replacement item automatically. Expanded empty groups remain visible with
one non-interactive placeholder row.

## Why this matters to the user

Older unpinned rows load while scrolling without requiring users to expand time groups. Display grouping no longer
silently changes item order, manual order enables row dragging, and right-side lists follow the same selected sort.
Assistant, agent, and work-directory grouped views also show the complete owner catalog, including empty groups; each
expanded group loads its own conversation or task stream.

## What the user should do

Nothing — automatic. Choose a different sort from the list options menu if preferred.
