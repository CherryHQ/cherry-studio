---
title: Input trigger settings removed
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-06-01
---

## What changed

The chat input settings for pasting long text as files and enabling `/` or `@` quick menu triggers were removed. Long text pastes are always converted to a file when the text is longer than 1500 characters, and quick menu triggers are always enabled where the composer supports them.

## Why this matters to the user

Users will no longer see these two switches in message input settings. Existing saved values for those settings are ignored.

## What the user should do

Nothing - automatic.

## Notes for release manager

Merge this with other input/composer setting cleanup notes if release prep groups settings changes together.
