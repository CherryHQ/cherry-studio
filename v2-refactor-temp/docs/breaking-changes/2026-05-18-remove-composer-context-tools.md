---
title: 'Composer clear-topic and new-context tools removed'
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-05-18
---

## What changed

The v2 composer no longer includes the clear-topic tool button or the new-context tool button. The composer-level clear shortcut is also not carried forward as part of this input surface.

## Why this matters to the user

Users who previously used the input box toolbar to clear the current topic or start a new context will no longer see those actions in the composer in v2.

## What the user should do

Use topic-level controls where available, or start a new topic when a clean conversation context is needed.

## Notes for release manager

This change removes the legacy Inputbar tool registrations for `clear_topic` and `new_context` from the composer tool system. The underlying topic management surfaces may still provide separate topic-level actions.
