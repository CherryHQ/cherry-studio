---
name: code-mate-qoder
description: Runs the Code Mate Qoder CN CLI non-interactively with structured output. Use when the user asks to delegate a bounded coding task to Qoder.
---

# Qoder CN CLI

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v qoderclicn`. If it is missing, stop and ask the user to install Qoder CLI in Code Mate.
3. Run one stateless task:

```bash
qoderclicn -p "<prompt>" -o json --no-session-persistence
```

Code Mate installs the CN executable `qoderclicn`, not `qoder`. Pass the prompt as one quoted argument. Parse the JSON response and check `is_error`; published exit-code behavior is incomplete, so a zero exit alone is not success. Never start the interactive UI or a login flow.

## Authentication And Permissions

If Qoder reports missing authentication, trust, model, or provider configuration, stop and ask the user to configure Qoder CLI in Code Mate. Never request, read, print, or copy credentials.

Headless mode denies permissions that would require asking. Keep that default for analysis. Only when the user explicitly requests workspace changes may the command select the narrowest non-default permission mode, and only after the target directory is trusted through Code Mate.

Example: ask Qoder to review a named file without editing, run the command above, and accept the result only when `is_error` is false.
