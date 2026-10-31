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
eval "$(cat ~/.cherrystudio/code-cli/command-code.env 2>/dev/null)" && command-code -p "<prompt>"
```

Pass the prompt as one quoted argument. The shell resolves the managed credential from Cherry Studio's protected credential file at runtime via the export script — the key itself never appears in the command, the transcript, or the environment you can inspect. Do not print, redirect, or inline either file's contents; the script only substitutes the credentials file into the environment variable the current configuration expects. Cap long tasks with `--max-turns`. For analysis-only tasks pass `--permission-mode plan`; never pass `--permission-mode yolo` or `--yolo`. Treat a nonzero exit as failure, and treat the printed answer as the result. Never start the interactive TUI or login flow from the agent task.

## Authentication And Permissions

The command above authenticates against the managed endpoint configured in Code Mate; Cherry Studio keeps both files in sync with that configuration — they are rewritten on every Code Mate config save and every launch from Cherry Studio's CLI page. The export script binds the credential to the variable name the current configuration carries (the name changes on every save), carries a non-secret stand-in token when the configured provider needs no key (for example a local Ollama), and both files are removed when no provider is configured. If the export script is missing (the `eval` resolves to nothing) or Command Code still reports missing login, API key, model, or provider configuration, stop and ask the user to save the configuration in Code Mate or launch Command Code once from Cherry Studio's CLI page. Never request, read, print, or copy credentials.

Only allow modification tools when the user explicitly requests workspace changes, and prefer read-only instructions in the prompt otherwise. Never pass a flag or setting that relaxes the permission mode.

Example: ask Command Code to explain the cause of a failing test without editing, run the command above, then summarize the result within the chosen timeout.
