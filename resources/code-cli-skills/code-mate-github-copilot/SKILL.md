---
name: code-mate-github-copilot
description: Runs GitHub Copilot CLI programmatically for repository analysis and coding tasks. Use when the user asks to delegate work to Copilot CLI or obtain a Copilot coding-agent result.
---

# GitHub Copilot CLI

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v copilot`. If it is missing, stop and ask the user to install GitHub Copilot CLI in Code Mate.
3. Run one non-interactive task:

```bash
copilot -p "<prompt>" -s --output-format json --no-ask-user
```

Pass the prompt as one quoted argument. Parse stdout as JSONL and treat an error event or nonzero exit as failure; the published exit-code contract is incomplete. Never start the interactive UI or an authentication flow.

## Authentication And Permissions

If Copilot reports a missing login, subscription, or token configuration, stop and ask the user to configure GitHub Copilot CLI in Code Mate. Never request, read, print, or copy credentials.

`--no-ask-user` prevents an unattended approval prompt. Keep tools denied by default. When the user explicitly requests workspace changes, add only narrowly scoped `--allow-tool` entries; never use `--allow-all` as a shortcut.

Example: ask Copilot to explain a failing test without modifying files, run the command above, and summarize the final JSONL result plus any denied tool request.
