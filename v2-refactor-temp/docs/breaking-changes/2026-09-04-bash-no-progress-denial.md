---
title: Agent Bash calls that repeat with byte-identical output are now denied
category: changed
severity: notice
introduced_in_pr: "#19906"
date: 2026-09-04
---

## What changed

In Claude Code agent sessions, when the exact same Bash command has already run 3 times in a row with byte-identical output, the next identical call is denied with an explanation instead of executing. Any output change, a completed file edit, or the user pressing Esc resets the count. The denial applies in every permission mode, including bypass-permissions runs.

## Why this matters to the user

Unattended agent runs could previously burn tokens retrying a command that provably returns the same result. Those loops now stop at the 4th attempt and the agent is told to diagnose, vary the command, or report the blocker. The one visible narrowing: a deliberate workflow that polls a command expecting identical output (for example waiting on a health endpoint that never changes) is interrupted after 3 identical results and must vary the invocation or ask the user.

## What the user should do

Nothing — automatic. If an agent legitimately needs to poll, re-running the command after any edit, after pressing Esc once, or with a trivially varied invocation (such as adding `&& true`) starts a fresh count.

## Notes for release manager

Only affects the Claude Code runtime's agent sessions; terminal usage by the user directly is untouched.
