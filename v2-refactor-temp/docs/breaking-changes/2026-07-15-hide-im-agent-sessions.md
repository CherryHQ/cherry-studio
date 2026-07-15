---
title: "IM agent sessions no longer appear in Cherry session lists"
category: changed
severity: notice
introduced_in_pr: "#17027"
date: 2026-07-15
---

## What changed

Agent conversations started from connected IM channels no longer appear in Cherry Studio's agent session lists, latest-session restore, or global search.

## Why this matters to the user

Private chats and group chats from Feishu, WeChat, and other connected IM platforms no longer clutter or mix with sessions created inside Cherry Studio. The conversations remain available to the connected agent at runtime.

## What the user should do

Nothing — the change is automatic for newly created IM sessions.

## Notes for release manager

Sessions created before this change cannot be identified reliably and may remain visible.
