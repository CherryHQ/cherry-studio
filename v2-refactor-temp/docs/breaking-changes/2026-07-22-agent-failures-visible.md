---
title: "Agent failures no longer appear as blank replies"
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-22
---

## What changed

Agent turns that fail or finish without displayable content now show an error instead of an empty assistant reply. In-progress task indicators are also terminalized when their stream is interrupted.

## Why this matters to the user

Failed Agent runs no longer look like blank responses or tasks that continue spinning indefinitely.

## What the user should do

Nothing — automatic.

## Notes for release manager

The underlying provider failure is still reported separately; this change makes the terminal UI state accurate and preserves Agent error diagnosis.
