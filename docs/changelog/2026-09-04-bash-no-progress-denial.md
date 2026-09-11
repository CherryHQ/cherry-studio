---
title: Agent Bash calls that repeat with byte-identical output are now warned about, then denied
category: changed
severity: notice
introduced_in_pr: "#19906"
date: 2026-09-04
---

## What changed

In Claude Code agent sessions, repeated identical Bash calls are now guarded in two tiers. When the exact same command has run 3 times in a row with byte-identical output, the next identical call is allowed but the agent receives a loop warning so it can self-correct. When the run reaches 5, the next identical call is denied with an explanation. Any output change, a completed file edit, or the user pressing Esc resets the count. The denial applies in every permission mode, including bypass-permissions runs.

## Why this matters to the user

Unattended agent runs could previously burn tokens retrying a command that provably returns the same result. Those loops now surface a warning at the 4th identical call and stop at the 6th, with the agent told to diagnose, vary the command, or report the blocker. The one visible narrowing: a deliberate workflow that polls a command expecting identical output (for example waiting on a health endpoint that never changes) is interrupted and must vary the invocation or ask the user.

## What the user should do

Nothing — automatic. If an agent legitimately needs to poll, any edit, pressing Esc once, or a trivially varied invocation (such as adding `&& true`) starts a fresh count.

## Notes for release manager

Only affects the Claude Code runtime's agent sessions; terminal usage by the user directly is untouched.
