---
name: code-mate-command-code
description: Runs Command Code headlessly for repository analysis and coding tasks. Use when the user asks to delegate work to Command Code or obtain a Command-Code-based coding-agent result.
---

# Command Code

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v command-code`. If it is missing, stop and ask the user to install Command Code in Code Mate.
3. Run one task and exit:

```bash
command-code -p "<prompt>"
```

Pass the prompt as one quoted argument. Cap long tasks with `--max-turns`. For analysis-only tasks pass `--permission-mode plan`; never pass `--permission-mode yolo` or `--yolo`. Treat a nonzero exit as failure, and treat the printed answer as the result. Never start the interactive TUI or login flow from the agent task.

## Authentication And Permissions

If Command Code reports missing login, API key, model, or provider configuration, stop and ask the user to configure Command Code in Code Mate. Never request, read, print, or copy credentials.

Only allow modification tools when the user explicitly requests workspace changes, and prefer read-only instructions in the prompt otherwise. Never pass a flag or setting that relaxes the permission mode.

Example: ask Command Code to explain the cause of a failing test without editing, run the command above, then summarize the result within the chosen timeout.
