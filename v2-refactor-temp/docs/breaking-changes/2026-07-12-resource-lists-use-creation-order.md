---
title: Conversation and task lists no longer use date groups
category: changed
severity: notice
introduced_in_pr: 523ab28297
date: 2026-07-12
---

## What changed

The Time views for conversations and agent tasks now keep the pinned section followed by one stable creation-ordered list. The Today, Yesterday, This week, and Earlier groups and their expand/collapse controls have been removed; older unpinned rows load while scrolling.

## Why this matters to the user

Opening or updating an existing conversation or task no longer moves it between date sections. Users can scan one predictable newest-created-first list and scroll to reach older items.

## What the user should do

Nothing — automatic.

## Notes for release manager

If this local commit is later attached to a PR, replace the commit hash with the PR number.
