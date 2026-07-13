---
title: Reasoning controls move into model-aware response settings
category: moved
severity: notice
introduced_in_pr: #16955
date: 2026-07-13
---

## What changed

Chat and Agent sessions now configure thinking modes and reasoning effort through a model-aware response control beside the composer. Agent sessions also expose Fast mode there. Models with multiple effort levels use a slider, Auto is shown separately from fixed effort levels, and on/off thinking modes use a switch. Reasoning effort is no longer listed in slash panels.

## Why this matters to the user

Users will find thinking controls in the same pill in Chat and Agent, and the choices can change when they switch models. Fast mode appears only in Agent for models that directly support it.

## What the user should do

Nothing - this is automatic. Open the response control beside the Chat or Agent composer when a different reasoning effort or Fast mode is needed.
