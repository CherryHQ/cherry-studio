---
title: Remaining replies inherit context when the selected reply is deleted
category: changed
severity: notice
introduced_in_pr: '#20233'
date: 2026-09-08
---

## What changed

Deleting the reply selected for context now selects its next neighbour in the same group's display order, or its previous neighbour when deleting the last reply. The order is creation time followed by message ID. Existing follow-up messages continue under that reply, and the remaining group stays visible.

## Why this matters to the user

Deleting one selected reply no longer makes the entire reply group disappear. Future requests use the replacement reply as context.

## What the user should do

Nothing — automatic. Select a different remaining reply if another response should supply context.

## Notes for release manager

Fixes issue #20219. Deleting an entire reply group retains its existing behavior.
