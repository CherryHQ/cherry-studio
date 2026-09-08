---
title: Agent session model and runtime selection are now independent
category: changed
severity: notice
introduced_in_pr: "#17632"
date: 2026-07-30
---

## What changed

Changing the model in an Agent session now affects only that session. A new, empty session can also choose its own
runtime; changing runtime clears the session model so the user can select one supported by the new runtime. The
Agent's model and runtime remain defaults for future sessions.

## Why this matters to the user

Different sessions belonging to the same Agent can use different models and runtimes. A runtime is locked after the
first message so an existing transcript is never resumed by a different runtime.

## What the user should do

Nothing — existing sessions are initialized automatically from their Agent's current model and runtime.
