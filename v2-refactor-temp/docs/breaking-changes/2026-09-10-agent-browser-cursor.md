---
title: Agent browser actions show a virtual pointer
category: changed
severity: notice
introduced_in_pr: 20342
date: 2026-09-10
---

## What changed

When an Agent clicks, hovers or scrolls in its visible browser pane, a virtual pointer shows the target.
It does not move the system cursor or prevent users from interacting with the page.

## Why this matters to the user

Users can follow the Agent's pointer actions. The existing browser pane still opens as before;
background execution is not introduced by this change.

## What the user should do

Nothing — automatic.

## Notes for release manager

The pointer respects reduced motion. Only the cursor portion of issue #20335 is included.
