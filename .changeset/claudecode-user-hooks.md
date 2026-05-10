---
'CherryStudio': patch
---

feat(claudecode): support user-defined hooks from settings.json and skill files

Load and merge user-defined hooks from project-level, user-level, and Cherry Studio-isolated
settings.json. Converts command-type hooks into SDK HookCallbacks. Supports all hook events
(PostToolUse, Stop, UserPromptSubmit, etc.) alongside Cherry Studio's system hooks.
Auto-allows Read/Write/Edit on planning files (task_plan.md, findings.md, progress.md) to
prevent approval fatigue from skills that frequently update these files.
