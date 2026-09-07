---
title: "Channel conversations start a new session after upgrade"
category: data-migration
severity: notice
introduced_in_pr: "#18544"
date: 2026-08-18
---

## What changed

Channel sessions now route independently for each direct chat, group chat, or thread. Existing channel sessions are preserved, but start a new routed session when the next inbound channel message arrives after upgrading.

## Why this matters to the user

The previous channel data does not identify which external conversation owned a session. Assigning it to a chat or thread would risk exposing one conversation's context to another, so the first new message starts with a fresh session.

## What the user should do

Nothing — the new session is created automatically. Open the existing session in Cherry Studio if you need to refer to its earlier context.

## Notes for release manager

This applies only to existing channel sessions migrated from the prior single-session-per-channel model.
