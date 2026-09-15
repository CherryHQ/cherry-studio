---
title: Hand off a Chat conversation to an Agent
category: changed
severity: notice
introduced_in_pr: '#20168'
date: '2026-09-07'
---

## What changed

Select an Agent with `@` in Chat, review and edit the task and generated summary, then confirm to start a new Agent session. The preview also lets you choose the summary model, workspace and attachments.

## Why this matters to the user

The Agent can read the original conversation when the summary omits details. Both conversations provide navigation to the handoff, and Agents can discover another Agent when delegating a task.

## What the user should do

No migration or settings changes are required. Review the handoff before confirming; save a temporary Chat using the existing save action if its original history must remain available.

## Notes for release manager

Existing Agent session creation calls retain their behavior when no target Agent is selected. Temporary conversations retain their existing lifetime.
