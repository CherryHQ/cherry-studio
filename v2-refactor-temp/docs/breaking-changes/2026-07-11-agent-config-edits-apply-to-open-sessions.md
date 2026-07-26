---
title: Agent configuration edits now take effect in already-open sessions
category: changed
severity: notice
introduced_in_pr: "#16946"
date: 2026-07-11
---

## What changed

Editing an agent while one of its sessions is open now takes effect in that session: permission-mode changes apply immediately (even mid-response), and everything else — MCP server set or definitions, plan/small models, skills enabled/disabled, workspace binding, max turns, instructions, provider API keys — applies from the next message. Previously most of these edits were silently ignored by an open session until it sat idle for 5 minutes or was reopened; MCP server edits in particular did nothing at all to a running session.

## Why this matters to the user

Users no longer need to close and reopen an agent session (or wait out the idle window) for configuration changes to land. The first message after such an edit may start slightly slower, because the session's runtime reconnects to pick up the new configuration.

## What the user should do

Nothing — automatic.

## Notes for release manager

An in-flight response is never interrupted by a configuration edit; the new configuration applies from the next message (permission-mode tightening is the exception — it applies immediately for safety). Merge with any other agent-session reconcile entries if more land before release.
