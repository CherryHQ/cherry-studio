---
title: Agent notifications now require a trusted target
category: changed
severity: breaking
introduced_in_pr: '#19289'
date: 2026-08-24
---

## What changed

Agent Sessions without a source channel or configured scheduled-task channels no longer expose the `notify` tool. Channel Sessions default to their source channel, and scheduled cron and heartbeat runs deliver only to the channels configured for that task.

A channel Session may still name another channel owned by the same Agent, but only while that channel is connected. Configured recipients keep their authority whether or not they are connected.

## Why this matters to the user

Agent notifications no longer broadcast to every connected channel by default. Existing Agent instructions that rely on an unscoped `notify` call may no longer send a message when the Session has no trusted destination.

## What the user should do

Start the Agent from a channel, or configure destination channels for the scheduled task. Use an explicit configured channel ID only when selecting one allowed recipient. If a cross-channel notification is rejected, check that the target channel is connected and retry once it reconnects.

## Notes for release manager

Mention that this prevents unintended cross-channel delivery.
