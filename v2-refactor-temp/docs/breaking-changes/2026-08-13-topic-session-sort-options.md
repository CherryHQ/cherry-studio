---
title: Conversation and task lists gain sorting controls
category: changed
severity: notice
introduced_in_pr: "#16998"
date: 2026-08-13
---

## What changed

Conversation and agent-task list options now separate display mode from sorting. Ordinary rows can be sorted by
creation time, activity time, or manual order; both lists default to creation time.

## Why this matters to the user

Changing how a list is grouped no longer silently changes its item order. Manual order enables row dragging, while
timestamp sorts show the newest rows first. Right-side conversation and task panels follow the same selected sort.

## What the user should do

Nothing — automatic. Choose a different sort from the list options menu if preferred.
