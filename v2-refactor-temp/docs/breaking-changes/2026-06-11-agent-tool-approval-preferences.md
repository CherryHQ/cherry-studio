---
title: Agent tool auto-approval preferences reset
category: data-migration
severity: notice
introduced_in_pr: #15941
date: 2026-06-11
---

## What changed

Legacy agent `allowed_tools` auto-approval preferences are not migrated to the new `disabledTools` model. Existing agents start with no manually disabled tools after migration.

## Why this matters to the user

Tools that were previously auto-approved may ask for confirmation again under the new permission model. Manually disabled tools are now managed through the agent's disabled tools setting.

## What the user should do

Review each agent's tool settings after upgrading and disable any tools that should be blocked.

## Notes for release manager

This is a semantic model change: legacy `allowed_tools` represented auto-approval preferences, while `disabledTools` is a hard opt-out block.
