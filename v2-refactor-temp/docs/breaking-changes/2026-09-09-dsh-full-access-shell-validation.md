---
title: DSH approval feedback and Full Access shell validation
category: changed
severity: notice
introduced_in_pr: "#20214"
date: 2026-09-09
---

## What changed

DSH delivers tool-approval rejection reasons in the current turn. Full Access shell
tools omit escalation parameters and reject calls that still supply them with a
corrective error. Calls without a verified workspace are denied.

## Why this matters to the user

Agents can respond to rejection feedback immediately. Invalid escalation requests
execute no command and do not force the conversation to stop.

## What the user should do

No setup is required. If an agent repeats invalid requests, ask it to remove
`sandbox_permissions` and `justification`, or stop the run. Select a valid workspace
when tools report a missing one.

## Notes for release manager

Applies to DSH agent sessions. Full Access validation adds no general retry limit.
Use the [DSH upgrade checks](../../../docs/references/testing/dsh-runtime-upgrade.md)
for runtime and historical-log compatibility.
