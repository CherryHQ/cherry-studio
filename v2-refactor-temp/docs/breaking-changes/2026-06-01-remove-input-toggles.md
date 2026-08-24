---
title: Input trigger setting removed
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-06-01
---

## What changed

The chat input setting for enabling `/` or `@` quick menu triggers was removed. Quick menu triggers are always enabled where the composer supports them.

## Why this matters to the user

Users will no longer see this switch in message input settings. Existing saved values for this setting are ignored.

## What the user should do

Nothing - automatic.

## Notes for release manager

Merge this with other input/composer setting cleanup notes if release prep groups settings changes together.
