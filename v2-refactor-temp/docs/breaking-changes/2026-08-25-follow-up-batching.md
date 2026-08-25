---
title: Consecutive follow-ups may run together
category: changed
severity: notice
introduced_in_pr: "#18534"
date: 2026-08-25
---

## What changed

Compatible follow-up messages queued before the next runtime boundary are committed as one ordered turn. If that batch cannot be committed, its messages remain in the follow-up dock instead of being silently discarded.

## Why this matters to the user

Several messages sent while an answer is active may reach the model together at the next safe boundary. Their order remains visible and can be changed or individual messages removed before that boundary.

## What the user should do

Nothing — automatic. Pause the follow-up dock when you want to review or edit the queue before it runs.

## Notes for release manager

This applies to compatible consecutive inputs only; runtime-native Agent steer delivery may still consume one message per driver boundary.
