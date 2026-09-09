---
title: DSH approval feedback and Full Access shell validation are clearer
category: changed
severity: notice
introduced_in_pr: "#20214"
date: 2026-09-09
---

## What changed

DSH agents receive tool-approval rejection reasons in the current turn rather than as a queued follow-up message. Full Access shell tools no longer advertise escalation parameters, and stale or malformed escalation requests receive a corrective tool error without forcibly terminating the conversation. Tool calls without a verified workspace are denied.

## Why this matters to the user

Agents can react to approval feedback immediately. A Full Access agent that still requests an upgrade must omit the redundant parameters before its command can run; this is not automatic approval or same-mode escalation as a no-op.

## What the user should do

Nothing — automatic. If the agent repeats an invalid escalation, ask it to remove sandbox_permissions and justification or stop the run. Select a valid workspace if tools report that the caller has no verified workspace.

## Notes for release manager

This applies to DSH agent sessions, not the user's terminal. The earlier counter-based forced stop in this PR was removed after review; there is no general retry limit. Runtime upgrade and historical-log compatibility require the checks in docs/references/testing/dsh-runtime-upgrade.md.
