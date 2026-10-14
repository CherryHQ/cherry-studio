---
name: code-mate-kimi-code
description: Runs Kimi Code in non-interactive prompt mode and parses its event stream. Use when the user asks to delegate a bounded repository task to Kimi Code.
---

# Kimi Code

## Run

1. Set the Bash working directory to the smallest directory the user authorized and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v kimi`. If it is missing, stop and ask the user to install Kimi Code in Code Mate.
3. Run one prompt and exit:

```bash
kimi -p "<prompt>" --output-format stream-json
```

Pass the prompt as one quoted argument. Parse stdout as JSONL, preserve event order, and extract the final assistant result. Treat an error event or nonzero exit as failure. Never start the interactive UI or `kimi login`.

## Authentication And Permissions

If Kimi reports missing login, model, or provider configuration, stop and ask the user to configure Kimi Code in Code Mate. Never request, read, print, or copy credentials.

Prompt mode automatically approves tool calls and rejects `--yolo`, `--auto`, and `--plan`; those flags cannot make it safer. Do not run it against a writable project for a read-only task. Use a disposable or read-only copy instead. Run against the real project only when the user explicitly requests workspace changes, constrain the directory, and inspect the diff afterward.

Kimi writes session state under `KIMI_CODE_HOME` (normally `~/.kimi-code`) before running workspace tools. If the host Bash reports a sandbox denial there for an explicitly approved write task, retry the exact command once with the narrowest host escalation. In DSH, request `sandbox_permissions: danger-full-access` with a justification naming Kimi's session storage, then wait for approval. Keep the working directory constrained; leave Kimi's config and credential files in place.

Example: for an approved implementation, ask Kimi to change only named files, run it in that project, parse the final JSONL event, and inspect the resulting diff.
