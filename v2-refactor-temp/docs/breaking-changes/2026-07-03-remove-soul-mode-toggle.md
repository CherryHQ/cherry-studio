---
title: Soul Mode (Autonomous Mode) toggle removed — always on for all agents
category: removed
severity: notice
introduced_in_pr: #16726
date: 2026-07-03
---

## What changed

The Soul Mode / Autonomous Mode toggle is gone from agent settings. Every agent
now always runs with the autonomy features that toggle used to gate: the claw
cron/notify/config tools, the agent-memory tools, and the workspace persona
prompt (SOUL.md and related workspace files). Scheduled tasks and channels no
longer require Soul Mode or the bypassPermissions permission mode — any agent
can be used for them.

## Why this matters to the user

The "Autonomous Mode" switch no longer appears in the agent edit dialog. Agents
that previously had it disabled will now expose the autonomous task-management
and memory tools and read the workspace persona prompt. `permission_mode` is
now fully independent: choosing bypassPermissions no longer implies (or is
implied by) any autonomy setting, and the scheduled-tasks page lists all
agents instead of only Soul-Mode/bypass ones.

## What the user should do

Nothing — automatic. Any stored `soul_enabled` value in an agent's
configuration is ignored. Users who relied on Soul Mode being off to hide the
autonomy tools can restrict individual tools via the agent's tool settings.

## Notes for release manager

- Spans the four commits of PR #16726: unconditional soul-mode behavior in
  main, renderer/schema flag removal, CherryClaw branding removal, and the
  i18n cleanup.
- Related earlier entry: `2026-06-18-agent-create-defaults-bypass-soul.md` —
  the create-flow default it describes is superseded for the soul half
  (`soul_enabled` no longer exists); merge when aggregating.
- CherryClaw branding was removed in the same PR: UI strings and i18n keys now
  say "channels" / "tasks" without the brand name.
