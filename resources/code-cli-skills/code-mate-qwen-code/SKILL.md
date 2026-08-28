---
name: code-mate-qwen-code
description: Runs Qwen Code headlessly for repository analysis and coding tasks. Use when the user asks to delegate work to Qwen Code or obtain a Qwen-based coding-agent result.
---

# Qwen Code

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v qwen`. If it is missing, stop and ask the user to install Qwen Code in Code Mate.
3. Run one task and exit:

```bash
qwen -p "<prompt>" --output-format json
```

Pass the prompt as one quoted argument. Parse the JSON result and treat a structured error or nonzero exit as failure. Never start the interactive UI or OAuth flow from the agent task.

## Authentication And Permissions

If Qwen reports missing login, API key, model, or provider configuration, stop and ask the user to configure Qwen Code in Code Mate. Never request, read, print, or copy credentials.

Use the default restricted approval behavior for analysis. Add bounded turn or tool-call limits for large tasks. Only allow modification tools when the user explicitly requests workspace changes, and never use `--yolo`: it grants approval without providing a sandbox.

Example: ask Qwen to identify the cause of a failing test without editing, run the command above, then summarize the parsed result within the chosen timeout.
