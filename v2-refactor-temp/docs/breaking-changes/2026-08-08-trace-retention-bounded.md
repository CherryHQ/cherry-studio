---
title: Developer-mode trace viewer keeps only recent trace data
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-08
---

## What changed

The AI trace data captured under Settings → Developer Mode is now bounded instead of growing for the
lifetime of a topic. Each topic's trace history file is capped (8 MiB, oldest spans dropped first),
and a single span keeps at most its 200 most recent log events or 2 MiB of them, whichever comes
first. Previously nothing aged out: measured trace files reached 66 MB for one topic and 185 MB
across a two-day session, with individual spans holding ~20 MB of captured request/response bodies.

## Why this matters to the user

Developer-mode users who open the trace pane on a long Claude Code session will see the oldest turns
disappear from the trace list over time, and very large spans show a truncated event list rather than
every captured body. In exchange the trace pane stops stalling the app while it is open — the old
viewer re-read and re-sent the entire trace file several times a second. Users who never enable
developer mode are unaffected; trace capture is off for them.

## What the user should do

Nothing — automatic. Existing oversized trace files are trimmed on the next flush rather than
deleted. Settings → Developer Mode → clear trace local data still removes everything at once.

## Notes for release manager

Developer-mode-only surface; safe to fold into a single "trace viewer performance" line rather than
listing the individual caps.
