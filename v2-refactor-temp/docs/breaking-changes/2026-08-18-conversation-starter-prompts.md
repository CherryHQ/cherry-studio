---
title: Empty conversations can offer generated starter prompts
category: changed
severity: notice
introduced_in_pr: "#18440"
date: 2026-08-18
---

## What changed

Empty Chat and Agent conversations can generate three localized starter prompts. Conversation Suggestions is off by default and uses a dedicated model when set, otherwise the default chat model.

## Why this matters to the user

Opening an empty conversation does not make a background model request until the user enables Conversation Suggestions in Settings > Default Model.

## What the user should do

Nothing — automatic. To show starter prompts, turn on Conversation Suggestions in Settings > Default Model and optionally pick a dedicated model.
