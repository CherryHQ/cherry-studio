---
name: code-mate-mcode
description: Runs MiniMax Code non-interactively for code analysis and implementation tasks. Use when the user asks to delegate bounded repository work to MiniMax Code.
---

# MiniMax Code

## Run

1. Set the Bash working directory to the smallest directory the user authorized and set a finite host timeout, normally 10 minutes.
2. Check availability with `command -v mcode`. If it is missing, stop and ask the user to install MiniMax Code in Code Mate.
3. Run one prompt and exit:

```bash
mcode exec "<prompt>" --output-format json --timeout 10m
```

Pass the prompt as one quoted argument. Parse the JSON result and report stderr and the exit status on failure. Never start the interactive TUI or `mcode login`.

## Authentication And Permissions

If MiniMax Code reports missing login, model, or provider configuration, stop and ask the user to finish MiniMax Code setup in Code Mate. Never request, read, print, or copy credentials.

Keep the permission policy at its default `smart` setting. For a read-only task, use a disposable or read-only copy because the agent can still request workspace tools. Run against the real project only when the user explicitly requests workspace changes, constrain the working directory, and inspect the diff afterward. Never use `--permission full` unless the user explicitly authorizes that broader access.

Example: for an approved implementation, ask MiniMax Code to change only named files, run the command above in that project, parse the JSON result, and inspect the resulting diff.
