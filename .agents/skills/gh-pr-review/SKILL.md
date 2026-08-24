---
name: gh-pr-review
description: Automated Cherry Studio review for local branches, PRs, commits, files, architecture docs, and repository skills. Use for code or documentation reviews that need project-specific naming, main/renderer/shared placement and dependency rules, IpcApi and DataApi boundaries, lifecycle/service ownership, renderer hooks, React/UI conventions, and tests. Supports single-agent review with interactive fix selection or multi-agent reviewer-verifier review with risk-based auto-fix. To diagnose gaps in the skill after a review session, run `/gh-pr-review diag`.
---

<!-- Based on https://github.com/Tencent/tgfx/tree/main/.codebuddy/skills/cr -->
<!-- Adapted for agent runtimes and the Cherry Studio tech stack -->

# /gh-pr-review — Code Review

Automated code review for local branches, PRs, commits, and files. Detects
review mode from arguments and routes to the appropriate review flow — either
quick single-agent review with interactive fix selection, or multi-agent
deep review with risk-based auto-fix.

Cherry Studio-specific review rules live in
`references/cherry-review-guidance.md`. Target review flows must load that file
for code, mixed, architecture-doc, and project-skill reviews so reviewers can
apply DataApi, service-boundary, renderer hook, React, UI, and type-contract
checks without relying on memory. That reference also defines which internal
docs, internal skills, external skills, and official websites to consult for
each changed area; load only the relevant subset.

All user-facing text matches the user's language. Use the runtime's interactive
dialog tool for questions and option selection when one is available; otherwise
ask one concise plain-text question and wait for the reply. Do not invent a tool
or syntax the runtime does not expose. For interactive multi-select: ≤4 items →
one question. >4 items → group by priority or category (each group ≤4 options),
then present all groups in one prompt.

## Route

Run pre-checks, then match the **first** applicable rule top-to-bottom:

1. `git branch --show-current` → record whether on main/master.
2. `git status --porcelain` → record whether uncommitted changes exist.
3. Check whether the current environment supports parallel subagents (agent
   teams), using the runtime-provided coordination tools.

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

> **Priority rule**: user intent (Rule 1, 2, 6) takes priority over working-tree
> state (Rule 3, 4, 5). A PR URL or PR number always goes to
> `references/pr-review.md` even when the working tree is dirty or the
> current branch is `main`/`master` — those state conditions only apply when
> the user did not specify a review target.

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
