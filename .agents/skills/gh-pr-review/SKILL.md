---
name: gh-pr-review
description: Review GitHub pull requests using the gh-pr-review extension. Use when asked to review a PR, add inline review comments, request changes, approve, or comment on a pull request. Manages the full review lifecycle — start, add inline comments, preview, and submit.
---

<!-- Based on https://github.com/Tencent/tgfx/tree/main/.codebuddy/skills/cr -->
<!-- Adapted for Claude Code Agent tool and Cherry Studio tech stack -->

# /gh-pr-review — Code Review

Automated code review for local branches, PRs, commits, and files. Detects
review mode from arguments and routes to the appropriate review flow — either
quick single-agent review with interactive fix selection, or multi-agent
deep review with risk-based auto-fix.

All user-facing text matches the user's language. All questions and option
selections MUST use your interactive dialog tool (e.g. AskUserQuestion) — never
output options as plain text. Do not proceed until the user replies. When
presenting multi-select options: ≤4 items → one question. >4 items → group by
priority or category (each group ≤4 options), then present all groups as
separate questions in a single prompt.

## Route

Run pre-checks, then match the **first** applicable rule top-to-bottom:

1. `git branch --show-current` → record whether on main/master.
2. `git status --porcelain` → record whether uncommitted changes exist.
3. Check whether the current environment supports Agent tool with parallel
   subagents (agent teams).

| # | Condition | Action |
|---|-----------|--------|
| 1 | `$ARGUMENTS` is `diag` | → `references/diagnosis.md` |
| 2 | `$ARGUMENTS` is a PR number or URL containing `/pull/` | → `references/pr-review.md` |
| 3 | Agent teams NOT supported | → `references/local-review.md` |
| 4 | Uncommitted changes exist | → `references/local-review.md` |
| 5 | On main/master branch | → `references/local-review.md` |
| 6 | Everything else | → Question below |

Each `→` means: `Read` the target file and follow it as the sole remaining
instruction. Ignore all sections below. Do NOT review from memory or habit —
each target file defines specific constraints on how to obtain diffs, apply
fixes, and submit results.

---

## Question

Ask a **single question**:
"Agent Teams is available (multiple agents working in parallel). Enable multi-agent review with reviewer–verifier adversarial mechanism and auto-fix?"
Provide 4 options:

| Option | Description |
|--------|-------------|
| Teams + auto-fix low & medium risk (recommended) | Multi-agent review; auto-fix most issues, only confirm high-risk ones (e.g., API changes, architecture). |
| Teams + auto-fix low risk | Multi-agent review; auto-fix only the safest issues (e.g., null checks, typos, naming). Confirm everything else. |
| Teams + auto-fix all | Multi-agent review; auto-fix everything. Only issues affecting test baselines are deferred. |
| Single-agent + manual fix | Single-agent review; interactively choose which issues to fix afterward. |

### Hand off

| Option | → | FIX_MODE |
|--------|---|----------|
| Teams + auto-fix low & medium risk (recommended) | `references/teams-review.md` | low_medium |
| Teams + auto-fix low risk | `references/teams-review.md` | low |
| Teams + auto-fix all | `references/teams-review.md` | full |
| Single-agent + manual fix | `references/local-review.md` | — |

Pass `$ARGUMENTS` to the target file. For teams-review, also pass `FIX_MODE`
(low / low_medium / full).
