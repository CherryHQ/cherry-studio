---
title: Agent "Soul/Autonomous mode" toggle removed — personality + autonomy on by default
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-06-28
---

## What changed

The per-agent "Soul mode" / "Autonomous mode" toggle is gone. Every agent now has the
personality system (identity + memory: `SOUL.md` / `USER.md` / `memory/`) and the autonomy
tools (cron / notify / config via `claw`, channels) **by default** — there is no longer an
opt-in flag.

Each agent's identity and memory now live in a stable, app-owned **agent root**
(`{userData}/Data/Agents/Roots/{agentId}`), separate from the per-session working directory.
Previously they were written into the working directory and (for system workspaces) did not
persist across sessions.

Two related behavior changes:
- Every new agent runs a one-time **bootstrap onboarding** on first use to establish its
  personality.
- The "interactive tools disabled" restriction (AskUserQuestion / plan mode / SDK Cron*) now
  applies only to **scheduled-task / heartbeat runs** (which can't wait for a human), not to
  interactive chat. Scheduled tasks carry their own permission mode (default bypassPermissions).

## Why this matters to the user

- The agent edit dialog no longer shows a Soul/Autonomous toggle; permission mode is always
  editable. Channels no longer warn "Soul mode required". Any agent can be scheduled.
- Interactive agents keep all tools (plan mode, AskUserQuestion); previously soul agents lost them.
- v1 users upgrading: each v1 agent's existing `SOUL.md` / `USER.md` / `memory/` is copied into
  its new agent root during migration; the original working directory is left untouched.

## What the user should do

Nothing — automatic. Existing soul data is migrated; existing non-soul agents simply gain the
personality/memory system (empty until used).

## Notes for release manager

- On-disk relocation: identity/memory moved from the working dir to `Data/Agents/Roots/{agentId}`.
- `soul_enabled` is removed from the agent configuration schema (stored values are ignored via the
  loose schema; no data loss).
