---
name: gh-pr-review
description: Automated Cherry Studio review for local branches, PRs, commits, files, architecture docs, and repository skills. Use for code or documentation reviews that need project-specific naming, main/renderer/shared placement and dependency rules, IpcApi and DataApi boundaries, lifecycle/service ownership, renderer hooks, React/UI conventions, and tests. Review depth adapts to the size of the change (single-agent or multi-agent reviewer-verifier). Report-only by default; code fixes and GitHub submission each require explicit invocation-time authorization (`fix` / `submit`); never prompts mid-review. To diagnose gaps in the skill after a review session, run `/gh-pr-review diag`.
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

**Authority model** — a review request authorizes analysis and reporting
only. The review target, review depth, and reviewer–verifier confidence never
grant execution authority; authority is granted explicitly at invocation
time, and execution is prompt-free only after it has been granted:

- **Report-only (default)**: every review, any target — findings are reported
  with proposed fixes. No working-tree edits, no GitHub writes.
- **Fix (explicit)**: granted only by the invocation — `fix` in `$ARGUMENTS`
  or equivalent explicit user wording ("review and fix …"). Local targets
  only. Auto-fixes **low-risk** findings (a single reasonable fix exists);
  medium- and high-risk findings are reported with the proposed fix, because
  multiple possible implementations must be surfaced, never silently picked.
  Applying fixes makes the session a coding task: the flow must then run the
  repository validation commands (`pnpm lint`, `pnpm test`, `pnpm format`)
  and report their results.
- **Submit (explicit)**: granted only by the invocation — `submit` in
  `$ARGUMENTS` or equivalent explicit user wording. PR flows then submit all
  confirmed findings without per-comment prompts. Approving or merging always
  requires its own explicit request.

## Route

First strip authority modifiers from `$ARGUMENTS` (equivalent explicit user
wording in the conversation counts the same; both default to `false`):

- `fix` → `AUTHORIZED_FIX = true` (meaningful for local targets)
- `submit` → `AUTHORIZED_SUBMIT = true` (meaningful for PR targets)

Then match the **first** applicable rule top-to-bottom:

1. `$ARGUMENTS` is `diag` → `references/diagnosis.md`.
2. `$ARGUMENTS` is a PR number or URL containing `/pull/` →
   `references/pr-review.md` (pass `AUTHORIZED_SUBMIT`; review depth adapts
   inside via the module-merge rule).
3. Everything else: determine the review scope, then route by size.
   - Scope: uncommitted changes exist and `$ARGUMENTS` is empty →
     `git diff HEAD --stat` plus untracked files; clean tree and empty
     `$ARGUMENTS` → branch diff vs the `main`/`master` merge-base; a commit,
     range, or file paths → as given.
   - Size: **≤ 1000 changed lines AND ≤ 20 files** →
     `references/local-review.md`; larger → `references/teams-review.md`.
   - Pass `AUTHORIZED_FIX` (commit and range targets are immutable history —
     always report-only regardless of the flag).

Each `→` means: `Read` the target file and follow it as the sole remaining
instruction. Ignore all sections below. Do NOT review from memory or habit —
each target file defines specific constraints on how to obtain diffs, apply
fixes, and submit results.

Never ask the user anything to route. Pass `$ARGUMENTS`, the determined
scope, and the authority flags to the target file.
