---
name: code-mate-hermes
description: Runs Hermes Agent in one-shot mode for bounded local tasks. Use when the user explicitly asks to delegate work to Hermes and accepts its automatic tool approval behavior.
---

# Hermes Agent

## Run

1. Set the Bash working directory to the smallest directory the user authorized and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v hermes`. If it is missing, stop and ask the user to install Hermes Agent in Code Mate.
3. Run one task and exit:

```bash
hermes -z "<prompt>"
```

Pass the prompt as one quoted argument. Treat stdout as final text. Exit zero means success, exit one means failure or no response, and exit two means invalid arguments or an empty failed/partial result. Never start the interactive UI or a login flow.

## Authentication And Permissions

If Hermes reports missing provider, model, or API configuration, stop and ask the user to configure Hermes Agent in Code Mate. Never request, read, print, or copy credentials.

One-shot mode automatically enables YOLO and hook acceptance and can load tools, memory, rules, and `AGENTS.md`. Do not run it in a writable project for read-only work. Use a disposable or read-only copy instead. Run it against the real project only when the user explicitly requests workspace changes, constrain the directory and prompt, and inspect the diff afterward.

Example: for an approved edit, ask Hermes to touch only named files, run it in that project, require exit zero, and inspect the resulting diff before reporting success.
