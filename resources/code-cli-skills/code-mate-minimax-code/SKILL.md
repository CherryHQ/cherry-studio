---
name: code-mate-minimax-code
description: Runs MiniMax Code headlessly for repository analysis and coding tasks. Use when the user asks to delegate work to MiniMax Code or obtain a MiniMax-based coding-agent result.
---

# MiniMax Code

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v mcode`. If it is missing, stop and ask the user to install MiniMax Code in Code Mate.
3. Run one task and exit:

```bash
mcode exec "<prompt>"
```

Pass the prompt as one quoted argument. For analysis-only tasks pass `--permission smart` explicitly; never pass `--permission full`. Treat a nonzero exit as failure, and treat the final answer text as the result. Never start the interactive TUI or login flow from the agent task.

## Authentication And Permissions

If MiniMax Code reports missing login, API key, model, or provider configuration, stop and ask the user to configure MiniMax Code in Code Mate. Never request, read, print, or copy credentials.

Only allow modification tools when the user explicitly requests workspace changes, and prefer read-only instructions in the prompt otherwise. Never pass a flag or setting that relaxes the permission mode.

Example: ask MiniMax Code to explain the cause of a failing test without editing, run the command above, then summarize the result within the chosen timeout.
