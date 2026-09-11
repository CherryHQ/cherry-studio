---
title: You are now notified when an Agent or assistant needs your approval
category: changed
severity: notice
introduced_in_pr: "#17651"
date: 2026-08-13
---

## What changed

When an Agent or assistant pauses for tool approval, Cherry Studio now surfaces it the same way it surfaces completions: an in-app card when another conversation is active, or a system notification when the app is in the background. Clicking either takes you straight to the waiting conversation.

## Why this matters to the user

Approval requests used to be visible only inside the conversation itself, so a run started in one session could sit blocked indefinitely while the user worked elsewhere.

## What the user should do

Nothing — in-app cards are automatic. Enable Agent & Assistant Notifications under Notification settings to also receive background system notifications.

## Notes for release manager

Merge with `2026-07-30-task-completion-notifications.md` — same PR, same delivery path, and both background notifications are gated by the single "Agent & Assistant Notifications" setting, whose description now covers completions and approval requests together.
