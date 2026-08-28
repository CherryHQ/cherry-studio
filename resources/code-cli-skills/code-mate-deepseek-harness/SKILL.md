---
name: code-mate-deepseek-harness
description: Runs DeepSeek Harness headlessly for bounded repository tasks. Use when the user asks to delegate analysis or implementation to DeepSeek Harness.
---

# DeepSeek Harness

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v dsh`. If it is missing, stop and ask the user to install DeepSeek Harness in Code Mate.
3. Run one headless task:

```bash
dsh --profile headless "<prompt>"
```

Pass the prompt as one quoted argument. Treat stdout as final text, not JSON. Exit zero means success; exit one means the task failed or did not complete. Never start the interactive UI or a login flow.

## Authentication And Permissions

If DSH reports a missing provider, model, or API configuration, stop and ask the user to configure DeepSeek Harness in Code Mate. Never request, read, print, or copy credentials.

Headless DSH can write to the workspace and creates a persistent session. For read-only work, explicitly tell it not to modify files and inspect the repository diff afterward. Allow modifications only when the user explicitly requested workspace changes, and restrict the working directory to the intended project.

Example: ask DSH to diagnose a test failure without editing, run it in the repository, confirm exit zero and a clean diff, then summarize its final text.
