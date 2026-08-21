---
title: Agent session model selection is now independent
category: changed
severity: notice
introduced_in_pr: "#17632"
date: 2026-07-30
---

## What changed

Changing the model in an existing Agent session now affects only that session. The Agent's default model is used
when creating future sessions and is no longer changed by the current session's model selector.

## Why this matters to the user

Different sessions belonging to the same Agent can keep different models. Switching one session's model no longer
silently changes the model used when another session is created.

## What the user should do

Nothing — existing sessions are initialized automatically from their Agent's current model.
