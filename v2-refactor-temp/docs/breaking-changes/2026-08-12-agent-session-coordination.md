---
title: "Agent Sessions can coordinate work"
category: other
severity: notice
introduced_in_pr: "#18180"
date: 2026-08-12
---

## What changed

Agent Sessions can now find other Sessions, create a new same-Agent Session, and send durable work to another Session. Session creation and sending require per-call approval, and completed actions link directly to the target Session from chat.

## Why this matters to the user

Users can delegate bounded work across Session timelines without keeping the originating tool call open. Requests and completion results survive ordinary app restarts.

## What the user should do

Nothing — approve Session creation or sending when the requested delegation is expected.

## Notes for release manager

Delivery is asynchronous and at-most-once at the model-turn boundary; external tool side effects cannot be made exactly-once across a crash.
