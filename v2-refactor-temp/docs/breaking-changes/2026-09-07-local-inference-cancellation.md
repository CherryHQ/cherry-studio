---
title: Cancelled local inference stops before the next request starts
category: changed
severity: notice
introduced_in_pr: "#19896"
date: 2026-09-07
---

## What changed

Cancelling an active local embedding or OCR request waits for its inference process to exit before starting the next request for that capability. Requests cancelled while still queued are skipped without stopping the active request.

## Why this matters to the user

Cancelled work cannot overlap the next request's use of the same native model resources. After cancelling an active request, the next request reloads the model and may take longer to start; downloaded model files are not removed.

## What the user should do

Nothing — automatic.
