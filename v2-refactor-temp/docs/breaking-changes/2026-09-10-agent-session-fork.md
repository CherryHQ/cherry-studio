---
title: Independent Agent session forks
category: changed
severity: notice
introduced_in_pr: 20340
date: 2026-09-10
---

## What changed

Pi, Claude and DSH assistant menus can create an independent Agent session from
a completed turn with a valid supported native checkpoint. Ordinary topic branches
are unchanged.

Forked names receive an available numeric suffix, for example `Session (1)` and
`Session (2)`. Forking a child increments the existing trailing number instead of
appending another suffix, continuing after the highest matching number for the Agent.

## Why this matters to the user

The source can continue running. New sessions keep their visible history through
the selected turn and resume from independent native history. They do not inherit
queued messages, approvals, running tasks or usage charges.

User directories remain shared; system directories copy current files.
Forking does not restore historical file versions or roll workspace changes back.
DSH forks keep their own tool and approval identity while the source is running.

Pi, Claude and DSH continue to manage their own context and compaction. Agent
forking is independent of Chat compression settings.

## What the user should do

Valid checkpoints fork directly without a dialog. Older messages without a
checkpoint, incomplete turns and unavailable native histories stay disabled with
a reason. Missing, corrupt, changed or unsupported native history cannot create
a fork. If the native history becomes unavailable after selecting the menu action,
the operation fails explicitly and does not create an empty session.

If files change while a system workspace is being copied, retry the fork.
Coordinate changes between sessions that share a user workspace.

## Notes for release manager

Confirm all three live runtime resume paths and the manual matrix in the
[Agent Session Fork Verification reference](../../../docs/references/testing/agent-session-fork.md)
before release. Claude SDK compaction metadata and replacement references must
survive native forking; unsupported metadata prevents publication.

## Fork recovery

The publication journal records native SDK artifacts, ownership and commit state.
Recovery preserves committed children and only removes proven operation-owned
artifacts. Registered workspace references and uncertain ownership preserve files.
Deleting a parent leaves a published child's history independent. A child whose
required native history is missing or invalid must fail to resume explicitly.
