---
name: code-mate-antigravity
description: Runs Antigravity CLI headlessly for repository analysis and coding tasks. Use when the user asks to delegate work to Antigravity CLI or compare its result with another coding agent.
---

# Antigravity CLI

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v agy`. If it is missing, stop and ask the user to install Antigravity CLI in Code Mate.
3. Run one task and exit:

```bash
agy -p "<prompt>" --output-format json
```

Pass the prompt as one quoted argument. Print mode waits up to `--print-timeout` (5m by default); pass a shorter value when the caller's own timeout is tighter.

Parse the JSON result and read its `status` field: anything other than a success status is a failure, and `error` carries the reason. Treat unparseable output as failure too. Never start interactive Antigravity or an authentication flow.

## Authentication And Permissions

Antigravity refuses to run headlessly until it is signed in — it returns `status: "ERROR"` with `authentication failed or timed out` and tells you to run `agy` to log in. Do not do that: stop and ask the user to finish Antigravity setup in Code Mate. Never request, read, print, or copy credentials.

Headless mode inherits the permission mode persisted in user settings, and reading and writing files inside the active workspace are auto-approved by default — the default is not a read-only boundary, and a prompt cannot make it one. Do not run it against a writable project for a read-only task. Use a disposable or read-only copy instead. Run against the real project only when the user explicitly requests workspace changes, constrain the directory, and inspect the diff afterward. Never pass `--dangerously-skip-permissions`, which auto-approves every tool request including outside the workspace.

Example: for an approved edit, ask Antigravity to touch only named files, run it in that project, parse the `response` and any reported `error`, and inspect the resulting diff before reporting success.
