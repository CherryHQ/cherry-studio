---
title: Logs now follow a retention setting, and error logs are kept 30 days instead of 60
category: changed
severity: notice
introduced_in_pr: '#20330'
date: 2026-09-10
---

## What changed

Settings → Data has a new "Keep logs for" option (7 / 14 / 30 / 90 days, default 30). Logs past that
window are deleted automatically at startup and every 12 hours. The same settings page's cache cleanup
dialog gained an "Old logs" option for clearing them on demand.

## Why this matters to the user

Error logs (`app-error.*.log`) used to be kept for 60 days regardless; with the default retention they
are now kept for 30, the same as the general logs. Anyone who diagnoses issues from old logs should
raise the setting to 90 days first.

## What the user should do

Nothing — automatic. Change "Keep logs for" if the default window is too short or too long.
