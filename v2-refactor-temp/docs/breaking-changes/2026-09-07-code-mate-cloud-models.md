---
title: Cherry Cloud models are no longer available in Code Mate
category: removed
severity: breaking
introduced_in_pr: "#20048"
date: 2026-09-07
---

## What changed

Managed Cherry Cloud models are no longer offered in Code Mate or through the public API gateway. Work can still use models that the Cherry Cloud service explicitly enables for the Agent feature.

## Why this matters to the user

An existing Code Mate configuration that selected a managed Cherry Cloud model must use a different provider before it can launch. Conversation, translation, and Work availability continue to follow the features declared by the service.

## What the user should do

Select a non-Cherry Cloud provider and model in Code Mate. No action is needed for Work configurations.
