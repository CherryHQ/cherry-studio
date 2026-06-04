---
title: Per-session agent config moves up to the parent agent
category: data-migration
severity: breaking
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

Cognitive config (`mcps`, `allowedTools`, `configuration` — permission
mode, max turns, env vars, soul/scheduler/heartbeat toggles) now lives on
the **agent**, not the session. v1 stored these on every session row;
the v1 → v2 migration carries them forward only on the parent agent and
drops every per-session override.

`agent_session` keeps just identity + naming + workspace binding +
ordering — no MCP allowlist, no tool allowlist, no permission mode, no
scheduler config.

## Why this matters to the user

If a user customized MCP servers, allowed tools, permission mode, or the
soul/scheduler/heartbeat settings on a specific session (not on the
parent agent), that override does not survive the upgrade. Every
migrated session falls back to whatever the parent agent has configured.

Visible places:

- Session settings panel: per-session controls for MCP / allowed-tools
  / permission mode no longer exist.
- Agent settings panel: the same controls now live here, and every
  session of that agent shares them.
- `claude-code` invocation: the session inherits the agent's settings.

## What the user should do

1. After upgrading, open each agent's settings and confirm the agent
   carries the configuration the user wants every session of it to use.
2. For workflows that previously relied on multiple sessions of the
   same agent having different MCP / permission settings, split them
   into separate agents instead. Cloning an agent (with its config) and
   pointing sessions at the right clone is the v2 idiom.

## Notes for release manager

Pair with [`2026-05-19-agent-session-primary-workspace.md`](./2026-05-19-agent-session-primary-workspace.md)
in the release note — both are the "session is now a thin handle around
its parent agent" theme.

If the migrator emits warnings for non-empty per-session overrides that
were dropped, surface the count so the user knows whether to audit.
