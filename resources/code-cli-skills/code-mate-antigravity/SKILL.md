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

Leave permission handling at its default; never pass `--dangerously-skip-permissions`, which auto-approves every tool request. Only when the user explicitly requests workspace changes may the command add `--mode accept-edits`, and only for the narrowest task needed.

Example: ask Antigravity to review a module without editing, run the command above from the repository, and summarize the parsed `response` and any reported `error`.
