---
title: Sidebar favorites reset during v2 migration
category: data-migration
severity: breaking
introduced_in_pr: #16875
date: 2026-07-10
---

## What changed

Cherry Studio v2 resets migrated sidebar favorites to Chat, Agents, Translation, Paintings, and Knowledge Base. Legacy visible and hidden sidebar icon settings are not preserved.

## Why this matters to the user

Users who customized the v1 sidebar will see the canonical five-tab layout after upgrading to v2.

## What the user should do

Review the sidebar after upgrading and reapply any preferred customization.

## Notes for release manager

This replaces the earlier migration behavior that rebuilt favorites from the legacy visible sidebar icon list.
