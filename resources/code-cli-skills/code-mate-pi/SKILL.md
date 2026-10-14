---
name: code-mate-pi
description: Runs Pi non-interactively and parses its JSON event stream for repository tasks. Use when the user asks to delegate a bounded analysis or implementation task to Pi.
---

# Pi

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v pi`. If it is missing, stop and ask the user to install Pi in Code Mate.
3. Run one sessionless task:

```bash
pi --mode json --no-session "<prompt>"
```

Pass the prompt as one quoted argument. Parse stdout as JSONL and inspect error events; Pi can report model or tool failure in the event stream, so process exit alone is insufficient. Never start interactive Pi or `/login`.

## Authentication And Permissions

If Pi reports missing login, model, provider, or API configuration, stop and ask the user to configure Pi in Code Mate. Never request, read, print, or copy credentials.

Pi has no tool-approval prompt and normally exposes read, write, edit, and Bash tools. For analysis, append `--tools read,grep,find,ls`. Include write, edit, or Bash only when the user explicitly requested workspace changes, and keep the tool list and working directory as narrow as possible.

Example: run a read-only diagnosis with `--tools read,grep,find,ls`, then use the final JSONL message only if no error event occurred.
