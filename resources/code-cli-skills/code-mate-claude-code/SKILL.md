---
name: code-mate-claude-code
description: Runs Claude Code non-interactively for code analysis and implementation tasks. Use when the user asks to delegate repository work to Claude Code or compare its result with another coding agent.
---

# Claude Code

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v claude`. If it is missing, stop and ask the user to install Claude Code in Code Mate.
3. Run one task and exit:

```bash
claude -p "<prompt>" --output-format json
```

Pass the prompt as one quoted argument. Parse the JSON result and report stderr and the exit status on failure. Never start the interactive REPL or `/login` flow.

## Authentication And Permissions

If Claude reports missing login, API credentials, or provider configuration, stop and ask the user to finish Claude Code setup in Code Mate. Never request, read, print, or copy credentials.

Keep tool access read-only by default. Add only the smallest necessary `--allowedTools` entries when the task explicitly requires tools, and grant edit or shell tools only when the user explicitly requested workspace changes. Do not use a permission-bypass mode.

Example: for a review request, ask Claude to inspect the current repository without changing files, run the command above, then summarize the parsed JSON result.
