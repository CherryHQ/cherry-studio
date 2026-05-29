---
title: Prompt Management simplified
category: changed
severity: notice
introduced_in_pr: "#13430"
date: 2026-05-06
---

## What changed

Prompt Management is now a single SQLite-backed prompt list with title and content only. Quick phrases are migrated into this list, while prompt versions, rollback, variables, and separate global/assistant prompt lists are removed.

## Why this matters to the user

Users will see the Quick Phrase settings entry replaced by Prompt Management, and prompt insertion from the Quick Panel now reads from the unified prompt list. Existing assistant-specific regular phrases are not migrated into the new prompt table.

## What the user should do

Review the unified Prompt Management list after upgrading and recreate any assistant-specific regular phrases that are still needed.

## Notes for release manager

Merge this with other v2 prompt-management release notes if the final product wording changes before v2.0.0.
