---
name: code-mate-opencode
description: Runs OpenCode non-interactively for repository analysis and coding tasks. Use when the user asks to delegate work to OpenCode or compare OpenCode with another coding agent.
---

# OpenCode

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v opencode`. If it is missing, stop and ask the user to install OpenCode in Code Mate.
3. Run one task and exit:

```bash
opencode run "<prompt>" --format json
```

Pass the prompt as one quoted argument. Parse stdout as a JSON event stream and treat an error event or nonzero exit as failure. Never start the interactive OpenCode UI or an authentication flow.

## Authentication And Permissions

If OpenCode reports a missing provider or credentials, stop and ask the user to configure OpenCode in Code Mate. Never request, read, print, or copy credentials.

Headless mode denies permission prompts by default; keep that behavior for analysis. Only when the user explicitly requests workspace changes may the command enable the minimum tools needed. Do not add `--auto` merely to avoid a denied permission.

Example: ask OpenCode to inspect a failing test without editing, run the command above from that repository, and summarize the final content event and any tool errors.
