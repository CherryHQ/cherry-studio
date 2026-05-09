---
title: Web Search blacklist subscriptions removed
category: removed
severity: breaking
introduced_in_pr: TBD
date: 2026-05-09
---

## What changed

Web Search no longer supports blacklist subscription feeds in v2. The manual Web Search blacklist remains available.

## Why this matters to the user

Users who configured blacklist subscription URLs in v1 will not see those feeds in v2, and their subscribed rules are not migrated into v2 preferences.

## What the user should do

Copy any required rules from subscription feeds into the manual Web Search blacklist.

## Notes for release manager

Merge with other Web Search v2 migration notes if the final release note groups removed Web Search settings together.
