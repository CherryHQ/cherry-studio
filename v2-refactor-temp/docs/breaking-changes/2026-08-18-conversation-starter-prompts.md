---
title: Empty conversations can offer generated starter prompts
category: changed
severity: notice
introduced_in_pr: "#18440"
date: 2026-08-18
---

## What changed

Empty Chat and Agent conversations can generate three localized starter prompts. Conversation Suggestions is off by default. When enabled, it uses an enabled chat-capable dedicated model when one is configured and available; otherwise it uses an enabled chat-capable default model, or localized fallback prompts if neither model is usable.

## Why this matters to the user

Opening an empty conversation does not make a background model request until the user enables Conversation Suggestions in Settings > Default Model.

## What the user should do

Conversation Suggestions stays off until you turn it on in Settings > Default Model. You can optionally pick a dedicated model there; the app falls back to an enabled chat-capable default model and then to localized prompts when needed.
