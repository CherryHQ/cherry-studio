---
title: New installations use classic owner layouts by default
category: changed
severity: notice
introduced_in_pr: #16875
date: 2026-07-11
---

## What changed

New Cherry Studio installations default Chat conversations to the assistant-grouped classic layout and Agent sessions to the agent-grouped classic layout. The grouping and layout remain controlled by the same display-mode setting.

## Why this matters to the user

On first launch, Chat and Agent pages show the owner resource rail and its conversation or session pane instead of the time-based modern sidebar.

## What the user should do

Nothing - this is automatic. Users who prefer the time-based modern layout can change the conversation or session display mode from the resource list controls.

## Notes for release manager

This applies to new-user defaults. Existing v2 users keep their saved display mode.
