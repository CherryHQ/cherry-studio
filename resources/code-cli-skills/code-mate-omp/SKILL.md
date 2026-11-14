---
name: code-mate-omp
description: Run OMP non-interactively for repository tasks. Use when the user asks to delegate analysis or implementation to OMP.
---

# OMP

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v omp`. If it is missing, stop and ask the user to install OMP in Code Mate.
3. Run one sessionless task:

```bash
omp --mode json --no-session "<prompt>"
```

Pass the prompt as one quoted argument. Parse stdout as JSONL and inspect error events; OMP can report model or tool failure in the event stream, so process exit alone is insufficient. Never start interactive OMP or `/login`.

## Authentication And Permissions

If OMP reports missing login, model, provider, or API configuration, stop and ask the user to configure OMP in Code Mate. Never request, read, print, or copy credentials.

OMP applies its configured approval mode and normally exposes read, write, edit, Bash, and code-intelligence tools. For analysis, append `--tools read,grep,glob`. Include write, edit, or Bash only when the user explicitly requested workspace changes, and keep the tool list and working directory as narrow as possible.

Example: run a read-only diagnosis with `--tools read,grep,glob`, then use the final JSONL message only if no error event occurred.
