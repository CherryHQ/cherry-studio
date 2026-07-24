---
name: gh-pr-review
description: Automated Cherry Studio review for local branches, PRs, commits, files, architecture docs, and repository skills. Use for code or documentation reviews that need project-specific naming, main/renderer/shared placement and dependency rules, IpcApi and DataApi boundaries, lifecycle/service ownership, renderer hooks, React/UI conventions, and tests. Review depth adapts to the size of the change (single-agent or multi-agent reviewer-verifier); self reviews auto-fix low/medium-risk findings, everything else is report-only; never prompts mid-review. To diagnose gaps in the skill after a review session, run `/gh-pr-review diag`.
---

<!-- Based on https://github.com/Tencent/tgfx/tree/main/.codebuddy/skills/cr -->
<!-- Adapted for agent runtimes and the Cherry Studio tech stack -->

# /gh-pr-review — Code Review

Automated code review for local branches, PRs, commits, and files. Detects
the review target from arguments, then picks the review depth from the size
of the change — small diffs get a single-agent review
(`references/local-review.md`), large diffs get the multi-agent
reviewer–verifier flow (`references/teams-review.md`), and PR targets get
worktree setup plus GitHub submission (`references/pr-review.md`) on top of
the same review mechanism.

Cherry Studio-specific review rules live in
`references/cherry-review-guidance.md`. Target review flows must load that file
for code, mixed, architecture-doc, and project-skill reviews so reviewers can
apply DataApi, service-boundary, renderer hook, React, UI, and type-contract
checks without relying on memory. That reference also defines which internal
docs, internal skills, external skills, and official websites to consult for
each changed area; load only the relevant subset.

All user-facing text matches the user's language. Reviews never pause to ask
the user anything mid-flow: no mode selection, no fix confirmation, no
submission preview.

**Fix policy** — only a **self review** may edit code: the scope is the
developer's own pending work (working tree, current branch, or file paths).
Self reviews auto-fix low- and medium-risk findings and report high-risk ones
with the proposed fix. Everything else — PR, commit, and range targets — is
report-only.

## Route

Match the **first** applicable rule top-to-bottom:

1. `$ARGUMENTS` is `diag` → `references/diagnosis.md`.
2. `$ARGUMENTS` is a PR number or URL containing `/pull/` →
   `references/pr-review.md` (report-only; review depth adapts inside via the
   module-merge rule).
3. Everything else: determine the review scope, then route by size.
   - Scope: uncommitted changes exist and `$ARGUMENTS` is empty →
     `git diff HEAD --stat` plus untracked files; clean tree and empty
     `$ARGUMENTS` → branch diff vs the `main`/`master` merge-base; a commit,
     range, or file paths → as given.
   - Size: **≤ 1000 changed lines AND ≤ 20 files** →
     `references/local-review.md`; larger → `references/teams-review.md`.
   - `SELF_REVIEW`: `true` when the scope is the working tree, current
     branch, or file paths; `false` for commit or range targets.

Each `→` means: `Read` the target file and follow it as the sole remaining
instruction. Ignore all sections below. Do NOT review from memory or habit —
each target file defines specific constraints on how to obtain diffs, apply
fixes, and submit results.

Never ask the user anything to route. Pass `$ARGUMENTS`, the determined
scope, and `SELF_REVIEW` to the target file.
