---
name: kbd-inject-agent-rules
description: Idempotently inject the agent-rules or UI/UX-routing managed pack into a target project's CLAUDE.md and/or AGENTS.md. Re-runnable — overwrites only the selected fenced region; everything else is byte-preserved. Supports --refresh to re-validate cached source URLs, and --dry-run for a target-file diff preview.
---

# /kbd-inject-agent-rules

Inject either the canonical Karpathy + Claude-Code-author rules or the
existing-target-first, capability-aware UI/UX routing workflow into a
project's agent context files.

## What this does

1. Resolves target files from `--target` (default both) at `--path` (default `.`).
2. Resolves the selected `--pack` (default `agent-rules`) to its template,
   cache, and managed-marker prefix. For `uiux-routing`, a project-local
   `.kbd-orchestrator/references/uiux-skill-roster.md` overrides the bundled
   roster when present.
3. Optionally with `--refresh`, fetch-probes each selected cache source URL for
   its anchor keyword and updates that cache's `Last fetched` dates. Refresh
   failures warn but don't abort.
4. Builds the fenced-region content from the selected pack template.
5. For each target file:
   - If no marker present: appends the fenced region.
   - If valid marker pair present: replaces the region in place.
   - If markers corrupt (missing end, multiple starts): refuses to write.
6. With `--dry-run`, prints a diff preview and does not modify target files.
7. Writes target files atomically so an interrupted invocation never leaves a
   half-rewritten file.

## When to use

Use `--pack agent-rules` when a project's `CLAUDE.md` / `AGENTS.md` should
carry the canonical Karpathy + Claude Code rule sets. Use `--pack uiux-routing`
when UI work needs the managed incumbent-discovery and capability-selection
workflow. Run once during setup, then re-run to refresh only the selected
managed fence.

## Progress Signals (MANDATORY)

```
Starting kbd-inject-agent-rules — <target-summary>
Completed kbd-inject-agent-rules — <count> file(s) updated, <count> unchanged
```

## How to invoke

```bash
boss-mini kbd-inject-agent-rules.mjs \
  [--target CLAUDE.md|AGENTS.md|both] \
  [--path <project-root>] \
  [--pack agent-rules|uiux-routing] \
  [--refresh] \
  [--dry-run]
```

All flags are optional:

| Flag | Accepted value / behavior | Default |
|---|---|---|
| `--target` | `CLAUDE.md`, `AGENTS.md`, or `both` | `both` |
| `--path` | Existing project-root directory | `.` |
| `--pack` | `agent-rules` or `uiux-routing` | `agent-rules` |
| `--refresh` | Best-effort URL/anchor validation and selected-cache date refresh | off |
| `--dry-run` | Print target diffs without writing target files | off |
| `-h`, `--help` | Print usage and exit | — |

## Examples

```
/kbd-inject-agent-rules                                    # both files at .
/kbd-inject-agent-rules --target CLAUDE.md                 # CLAUDE.md only
/kbd-inject-agent-rules --path /Users/me/my-project        # different root
/kbd-inject-agent-rules --pack uiux-routing                # UI/UX workflow
/kbd-inject-agent-rules --dry-run                          # preview only
/kbd-inject-agent-rules --refresh                          # re-validate sources
```

## Refusal cases

- Target file contains the selected pack's start marker without its matching
  end marker → refuse, suggest manual repair.
- Target file contains multiple selected-pack start markers → refuse, suggest
  deduplication.
- `--target` value is not one of `CLAUDE.md` / `AGENTS.md` / `both` → usage error.
- `--pack` value is not `agent-rules` or `uiux-routing` → usage error.
- `--path` does not name an existing directory → usage error.

## Reference

- Agent-rules cache: `references/cache-agent-rules.md`
- Agent-rules template: `references/template-agent-rules.md`
- UI/UX routing roster: `references/cache-uiux-routing.md`
- UI/UX routing template: `references/template-uiux-routing.md`
