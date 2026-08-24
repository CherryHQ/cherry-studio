---
title: Prompt Management simplified
category: data-migration
severity: notice
introduced_in_pr: "#13430"
date: 2026-05-06
---

## What changed

Prompt Management is now a single SQLite-backed prompt list with title and content only. Global quick phrases and assistant-specific regular phrases are migrated into this list, while prompt versions, rollback, variables, and separate global/assistant prompt lists are removed. Missing legacy IDs and timestamps are repaired automatically during migration.

## Why this matters to the user

Users will see the Quick Phrase settings entry replaced by Prompt Management, and prompt insertion from the Quick Panel now reads from the unified prompt list. Assistant-specific regular phrases whose content satisfies the v2 prompt limits remain available there as global prompts; their former assistant association is not preserved. Empty or over-limit content is skipped.

## What the user should do

Migration is automatic. Review the unified Prompt Management list after upgrading if you want to reorder prompts that previously belonged to different assistants.

## Notes for release manager

Merge this with other v2 prompt-management release notes if the final product wording changes before v2.0.0.
