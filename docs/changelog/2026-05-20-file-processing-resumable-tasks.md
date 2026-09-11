---
title: File processing tasks now survive app restart
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

File processing tasks (OCR, document-to-markdown) are now backed by the JobManager and persist across app restarts. A remote task (doc2x, mineru, paddleocr document-to-markdown) that was uploaded but not yet finished when the app exits will continue polling after the next launch instead of being lost.

## Why this matters to the user

In v1, force-quitting the app during a long remote document-to-markdown conversion would silently lose the task — the user's API quota was already consumed, but no result was produced. After this change, the task resumes from where it left off, so the quota is not wasted.

This is currently only observable via the Component Lab File Processing demo page (File Processing is not yet exposed as a primary user feature in v2). The change becomes more visible once File Processing is promoted out of the lab.

## What the user should do

Nothing — automatic.

## Notes for release manager

Companion internal changes (no user impact): two IPC channels (`file-processing:get-task`, `file-processing:cancel-task`) are removed in favor of the generic Job DataApi (`GET /jobs/:id`, `DELETE /jobs/:id`). No external plugin consumes these channels.
