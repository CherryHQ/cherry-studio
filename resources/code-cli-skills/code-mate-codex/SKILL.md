---
name: code-mate-codex
description: Runs Codex CLI non-interactively for code analysis and implementation tasks. Use when the user asks to delegate repository work to Codex or obtain a second coding-agent result.
---

# Codex CLI

## Run

1. Set the Bash working directory to the exact project the user named and set a finite timeout, normally 10 minutes.
2. Check availability with `command -v codex`. If it is missing, stop and ask the user to install Codex CLI in Code Mate.
3. Run one task and exit:

```bash
codex exec "<prompt>" --json
```

Pass the prompt as one quoted argument. Parse stdout as JSONL, preserve event order, and use the final agent message as the result. Treat an error event or nonzero exit as failure. Never start interactive `codex` or `codex login`.

## Authentication And Permissions

If Codex reports missing login or API configuration, stop and ask the user to finish Codex setup in Code Mate. Never request, read, print, or copy credentials.

Use `--sandbox read-only` unless the user explicitly requested workspace changes. For an approved edit, use only the narrowest suitable sandbox and working directory; never add `--dangerously-bypass-approvals-and-sandbox`. Add `--skip-git-repo-check` only when the user intentionally selected a non-Git directory.

Example: for a review request, append `--sandbox read-only`, ask Codex not to modify files, and summarize the final JSONL message plus any reported errors.
