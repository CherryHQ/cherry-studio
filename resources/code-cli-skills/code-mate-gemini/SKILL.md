---
name: code-mate-gemini
description: Runs Gemini CLI headlessly for repository analysis and coding tasks. Use when the user asks to delegate work to Gemini CLI or compare its result with another coding agent.
---

# Gemini CLI

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v gemini`. If it is missing, stop and ask the user to install Gemini CLI in Code Mate.
3. Run one task and exit:

```bash
gemini -p "<prompt>" --output-format json
```

Pass the prompt as one quoted argument. Parse the JSON result and treat a JSON error or nonzero exit as failure. Never start interactive Gemini or an authentication flow.

## Authentication And Permissions

If Gemini reports missing authentication, project, or provider configuration, stop and ask the user to finish Gemini setup in Code Mate. Never request, read, print, or copy credentials.

Keep headless approval policy at its read-only default. Only when the user explicitly requests workspace changes may the command use the narrowest policy and tool permissions needed; do not enable unrestricted approval.

Example: ask Gemini to review a module without editing, run the command above from the repository, and summarize the parsed response and any reported error.
