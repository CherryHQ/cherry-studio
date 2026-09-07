---
title: Message Anchor is now the default navigation bar
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-05
---

## What changed

The message navigation bar now defaults to Message Anchor instead of None.

## Why this matters to the user

New users and v1 users who never selected a message navigation mode will see
the message anchor rail beside conversations. Existing saved selections remain
unchanged.

## What the user should do

Nothing — automatic. Users can still choose None or Navigation Buttons in
Message Settings.

## Notes for release manager

This changes only the fallback for a missing preference. It does not overwrite
an existing `chat.message.navigation_mode` value.
