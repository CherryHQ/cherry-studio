---
title: Scheduled tasks that repeat on an interval now keep a fixed schedule
category: changed
severity: notice
introduced_in_pr: '#18684'
date: 2026-08-16
---

## What changed

A scheduled task with an interval trigger ("every N minutes/hours") now fires on a fixed schedule counted from when the task was created. Previously the countdown restarted from zero every time the app launched, the task was re-enabled, or its settings were edited.

A fire time that passes while the app is closed is still skipped, not run late — that part is unchanged. Tasks with a cron trigger ("every day at 09:00") are unaffected.

## Why this matters to the user

The old behavior made a long interval unreachable on a computer that is not left running. A 6-hour task on a machine where the app is open about 4 hours a day never got 6 uninterrupted hours, so it never ran at all — silently, with nothing in the UI to indicate it. It also meant the actual run times drifted with whenever the app happened to be opened, so they were neither predictable nor stable.

After the change, those runs land on the same clock times every day, and a long-interval task runs whenever one of those times falls inside a session. On upgrade, an existing task's next run may arrive up to one interval earlier than the old behavior would have produced, because it is now measured from the task's creation time rather than from app launch.

## What the user should do

Nothing — automatic. A task whose timing looks surprising after the upgrade can be recreated to re-anchor its schedule to the current moment.

## Notes for release manager

Reported as #18607, which also asked for missed runs to be made up on startup (the v1 behavior). That half was deliberately not implemented and remains open — see the discussion on #18680. This entry should not promise catch-up.
