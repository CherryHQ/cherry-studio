---
title: Editing an agent no longer keeps its max-turns limit
category: data-migration
severity: breaking
introduced_in_pr: #16187
date: 2026-06-18
---

## What changed

The v2 agent edit dialog no longer surfaces or preserves the agent's `max_turns`
configuration. Saving any change to an agent (avatar, permission mode, env vars,
soul mode, heartbeat, …) rewrites its `configuration` without `max_turns`, so a
previously-set per-agent turn cap is dropped.

## Why this matters to the user

An agent that had a `max_turns` limit set (e.g. carried over from v1 or set
through an earlier build) silently loses it the next time the user edits that
agent in the library. There is no field in the v2 edit UI to view or restore it,
so the agent reverts to the runtime default turn behavior.

## What the user should do

Nothing — automatic. `max_turns` is being retired from the per-agent
configuration in v2; agents run under the default turn behavior.

## Notes for release manager

- The main-process runtime still reads `agent.configuration.max_turns`
  (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:304`). The retirement is
  currently only enforced at the edit-form layer, so the field is dropped on edit
  but still honored at runtime if present. **Follow-up:** remove the runtime read
  to fully complete the retirement, or re-surface the field if the cap is meant to
  stay. Tracked as inherited from `feat/chat-page`.
- Behavior is inherited verbatim from `feat/chat-page` (added in
  `5383513090 feat(agent): enhance agent configuration with permission mode and
  soul mode options`); the durable change belongs upstream there as well.
