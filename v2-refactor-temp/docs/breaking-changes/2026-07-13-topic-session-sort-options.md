---
title: Conversation and task lists gain sorting controls
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-13
---

## What changed

The conversation and agent-task list options now separate display mode from sorting. Items can be sorted by latest update, creation time, or manual order; conversations default to creation time and agent tasks default to manual order.

## Why this matters to the user

Users can change the order of conversations or tasks inside assistant, work-directory, and agent groups without changing the order of those outer groups. Timestamp sorts show newest first, while manual order restores item dragging.

Changing sort or pin state keeps compatible rows mounted while the corresponding cursor windows restart from their first page, avoiding a full sidebar loading refresh.

## What the user should do

Nothing is required. Choose a sort from the list options menu when a different item order is preferred.

## Notes for release manager

Replace `TBD` with the PR number or direct-push commit hash before release aggregation.
