---
name: code-mate-letta
description: Run Letta Code non-interactively for coding tasks. Use when the user asks to delegate work to Letta Code.
---

# Letta Code

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v letta`. If it is missing, stop and ask the user to install Letta Code in Code Mate.
3. Run one task and exit:

```bash
letta -p "<prompt>" --output-format json
```

Pass the prompt as one quoted argument; add `--agent <id>` when the user names a specific Letta agent. Treat a nonzero exit as failure, and treat the agent's final reply as the result. Never start the interactive TUI or login flow from the agent task.

## Authentication And Permissions

If Letta Code reports missing authentication or agent configuration, stop and ask the user to log in to Letta from their own terminal. Never request, read, print, or copy credentials.

Only allow modification tools when the user explicitly requests workspace changes, and prefer read-only instructions in the prompt otherwise. Never pass a flag or setting that relaxes the permission mode.

Example: ask Letta Code to explain the cause of a failing test without editing, run the command above, then summarize the result within the chosen timeout.
