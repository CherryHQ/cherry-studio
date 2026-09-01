---
name: code-mate-openclaw
description: Runs a local OpenClaw agent non-interactively and returns its structured response. Use when the user asks to delegate a bounded task to the OpenClaw main agent.
---

# OpenClaw

## Run

1. Set the Bash working directory to the exact directory the user authorized and set a finite outer timeout, normally 11 minutes.
2. Check availability with `command -v openclaw`. If it is missing, stop and ask the user to install OpenClaw in Code Mate.
3. Run the local main agent once:

```bash
openclaw agent --local --agent main --message "<prompt>" --json --timeout 600
```

Pass the prompt as one quoted argument. Parse the JSON payload even when the process exits zero: OpenClaw can encode failure in a successful process exit. Report payload errors and timeouts as failures. Never start onboarding, the interactive TUI, or a login flow.

## Authentication And Permissions

If OpenClaw reports missing onboarding, provider, model, or credentials, stop and ask the user to configure OpenClaw in Code Mate. Never request, read, print, or copy credentials.

The local agent can invoke configured tools. Keep the prompt read-only by default and do not ask it to mutate files or external systems unless the user explicitly requested workspace changes or that external effect. Limit it to the selected working directory.

Example: ask the main agent to explain a module without changing it, then accept the response only when the JSON payload reports success.
