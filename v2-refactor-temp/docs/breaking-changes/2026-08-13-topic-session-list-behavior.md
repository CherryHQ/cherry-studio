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

## Why this matters to the user

Older unpinned rows load while scrolling without requiring users to expand time groups. Display grouping no longer
silently changes item order, manual order enables row dragging, and right-side lists follow the same selected sort.

## What the user should do

Nothing — automatic. Choose a different sort from the list options menu if preferred.
