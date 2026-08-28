---
name: gh-pr-review
description: Automated Cherry Studio review for local branches, PRs, commits, files, architecture docs, and repository skills. Use for code or documentation reviews that need project-specific naming, main/renderer/shared placement and dependency rules, IpcApi and DataApi boundaries, lifecycle/service ownership, renderer hooks, React/UI conventions, and tests. Review depth adapts to diff size and runtime subagent capability (single-agent or multi-agent reviewer-verifier). Report-only by default; code fixes and GitHub submission each require explicit invocation-time authorization (`fix` / `submit`). Normal-review prompts and safe interruption behavior follow the interaction contract below. To diagnose gaps in the skill after a review session, run `/gh-pr-review diag`.
---

<!-- Based on https://github.com/Tencent/tgfx/tree/main/.codebuddy/skills/cr -->
<!-- Adapted for agent runtimes and the Cherry Studio tech stack -->

# /gh-pr-review — Code Review

Automated code review for local branches, PRs, commits, and files. Detects
the review target from arguments, then picks the review engine from diff size
and runtime capability. Small diffs use single-agent review
(`references/local-review.md`). Large diffs use the multi-agent
reviewer–verifier flow (`references/teams-review.md`) only when independent
subagents are available; otherwise they fall back to single-agent review with
that limitation disclosed. PR targets add worktree setup and GitHub submission
(`references/pr-review.md`) around the same engine-selection contract.

Cherry Studio-specific review rules live in
`references/cherry-review-guidance.md`. Target review flows must load that file
for code, mixed, architecture-doc, and project-skill reviews so reviewers can
apply DataApi, service-boundary, renderer hook, React, UI, and type-contract
checks without relying on memory. That reference also defines which internal
docs, internal skills, external skills, and official websites to consult for
each changed area; load only the relevant subset.

All user-facing text matches the user's language.

## Interaction and interruption contract

Apart from the declared categories below, normal review is prompt-free: never
ask for mode selection, fix confirmation, finding selection, or submission
preview. A leaf flow may request input only when it explicitly declares one of
these categories:

- **Product decision** — in an interactive session, the Product Demand gate may
  ask the current user for a decision the review cannot derive. In an automated
  session, record the impact and open decision without deciding for the user.
- **Safety or environment blocker** — continuing would require destructive
  action, new authority, or missing external configuration. Declared examples
  are a dirty/mismatched review worktree, a missing canonical remote, cleanup
  of unexplained changes, removal of a failed fix patch, and a pending review
  draft holding comments this run did not confirm. In an interactive session,
  preserve state and ask only for the decision needed to proceed.
- **Explicit maintenance mode** — `diag` and separately requested checklist
  maintenance are interactive selection flows outside normal review. They may
  ask for the declared edit selection or persistent checkout/branch target.

An automated session never waits for user input. At a product decision it
continues record-only as specified below. At a safety/environment blocker it
preserves state, stops the affected flow safely, and reports the exact blocker
and required decision. In an explicit maintenance mode it reports candidates
or missing destination information, applies no selection-dependent edits, and
stops safely. No leaf flow may introduce another prompt category.

## Review Stages

Every review runs these stages in order. A later stage reviews only what
survived the earlier ones, so a stage never re-litigates an earlier verdict.

This table is the single source of truth for stage scope and references; a
leaf flow may not widen, narrow, or re-reference a stage.

| # | Stage | Applies to | Reference |
|---|-------|-----------|-----------|
| 1 | **Product Demand** (gate) | any change whose semantics affect the product | below |
| 2 | **Consumer** | any change that adds or expands shared surface | `references/consumer-review.md` |
| 3 | **Architecture-First** | code, mixed, Cherry architecture docs, project skills | `references/cherry-review-guidance.md` |
| 4 | **Implementation** | code, mixed | `references/code-checklist.md` (A/B) |
| 4 | **Implementation** | docs | `references/doc-checklist.md` (A/B) |
| 5 | **Style / conventions** | code, mixed | `references/code-checklist.md` (C) |
| 5 | **Style / conventions** | docs | `references/doc-checklist.md` (C) |

Stage applicability follows the changed content, not the commit label: a
documentation-only diff still runs stages 3–5 when it changes Cherry
architecture docs or project skills, and a code diff that also edits docs runs
both reference sets for stages 4–5.

### Stage 1: Product Demand gate

First inspect the semantics actually expressed or constrained by the change,
then decide whether it affects **product semantics, user-visible behavior, or
product direction**. Change labels are not sufficient evidence: internal
refactors and non-user-facing fixes often have no product impact, while docs,
tests, or tooling can record, lock, or alter product behavior. Skip this stage
entirely, in both interactive and automated runs, only after semantic review
confirms that the change is implementation-only; say nothing about the skipped
gate.

When there is product impact:

- **Interactive session (default)**: summarize the change's effect on product
  functionality and semantics, and ask the current user for the product
  decision. Do not infer automation from PR authorship, review ownership, or
  whether the user authored the decision. If the user judges the direction
  wrong, **stop the whole review immediately** — do not run Consumer,
  Architecture, Implementation, or Style stages, and do not report code
  findings. If the user approves the direction, continue with the remaining
  stages.
- **Automated session (explicit only)**: use this mode only when the invocation
  prompt or workflow context explicitly identifies a headless, CI, batch, or
  other automated run. Make **no** product decision on the user's behalf. Run
  the remaining stages, and in the final report summarize the product impact,
  the direction the change takes, and the points needing human confirmation.
  Never phrase this as product approval having been obtained.

## Authority model

A review request authorizes analysis and reporting only. The review target,
review depth, and reviewer–verifier confidence never grant execution
authority; authority is granted explicitly at invocation time, and execution
is prompt-free only after it has been granted:

- **Report-only (default)**: every review, any target — findings are reported
  with fix guidance. No working-tree edits, no GitHub writes.
- **Fix (explicit)**: granted only by the invocation — `fix` in `$ARGUMENTS`
  or equivalent explicit user wording ("review and fix …"). Local targets
  only. What each risk level then permits is owned by
  `references/judgment-matrix.md` § Handling by Risk Level; this section grants
  the authority and never restates the mapping.
  Applying fixes makes the session a coding task, so it must end with the
  validation selected per § Validation after applied fixes below.
- **Submit (explicit)**: granted only by the invocation — `submit` in
  `$ARGUMENTS` or equivalent explicit user wording. PR flows then submit all
  confirmed findings without per-comment prompts. Approving or merging always
  requires its own explicit request.

## Validation after applied fixes

Never run local lint, test, or format during a review that edited nothing.
When fixes were applied, select the validation matching the changed surface,
following `AGENTS.md` § Operational Rules ("Check what you changed, not the
whole repo"), and report the results:

- Docs/markdown-only fixes — including this skill's own files — run
  `pnpm docs:check`.
- Code fixes run `pnpm lint` (which already ends with `pnpm format`, so never
  invoke `format` again) plus the tests covering the change: a per-project
  wrapper such as `pnpm test:main <file>` or `pnpm exec vitest run <file>`.
  Never `pnpm test <path>` — that script chains several vitest invocations and
  the path reaches only the last one.
- Reserve the full `pnpm test` for a broad change whose affected tests cannot
  be named, and use `pnpm test:lint` when the CI-equivalent lint gate matters
  (`pnpm lint` tolerates oxlint warnings that CI denies).

## Route

First strip authority modifiers from `$ARGUMENTS` (equivalent explicit user
wording in the conversation counts the same; both default to `false`). Call
the remainder `REVIEW_TARGET` — every rule below, and every leaf flow, reads
`REVIEW_TARGET`, never the raw `$ARGUMENTS`:

- `fix` → `AUTHORIZED_FIX = true` (meaningful for local targets)
- `submit` → `AUTHORIZED_SUBMIT = true` (meaningful for PR targets)

Before choosing a review engine, inspect the runtime's exposed coordination
capabilities. Set `HAS_SUBAGENTS = true` only when it can launch an independent
reviewer and a fresh independent verifier. Parallel execution is not required;
sequential subagents still satisfy the isolation contract.

### Rules

Match the **first** applicable rule top-to-bottom:

1. `REVIEW_TARGET` is `diag` → `references/diagnosis.md`.
2. `REVIEW_TARGET` is `checklist`, or the user explicitly asks to adopt the
   proposed checklist candidates → `references/checklist-evolution.md`,
   entering at its Step 2. Maintenance runs only in the session that produced
   the candidates; it reviews nothing.
3. `REVIEW_TARGET` is a PR number or URL containing `/pull/` →
   `references/pr-review.md` (pass `AUTHORIZED_SUBMIT` and `HAS_SUBAGENTS`;
   the wrapper collects the exact PR scope before selecting the engine).
4. Everything else: derive the scope and `SMALL_SCOPE` per § Scope derivation
   below, then select the engine.
   - `SMALL_SCOPE = true` → `references/local-review.md`.
   - `SMALL_SCOPE = false` with `HAS_SUBAGENTS = true` →
     `references/teams-review.md`.
   - `SMALL_SCOPE = false` with `HAS_SUBAGENTS = false` →
     `references/local-review.md`; pass `LIMITED_SINGLE_AGENT = true` so the
     report explicitly states that a large diff received single-agent review
     without independent adversarial verification.
   - Pass `AUTHORIZED_FIX` (commit and range targets are immutable history —
     always report-only regardless of the flag).

Each `→` means: `Read` the target file and follow it as the sole remaining
instruction for how to obtain diffs, apply fixes, and submit results. Do NOT
review from memory or habit. The skill-wide sections — § Review Stages,
§ Authority model, § Validation after applied fixes, and § Scope derivation —
stay binding; the leaf flows reference them by name.

Never ask the user anything to route. Pass `REVIEW_TARGET`, the resolved
scope, `SMALL_SCOPE`, and the authority flags to the target file.

### Scope derivation

Reached only from Rule 4 above; `diag` and `checklist` targets never enter this
subsection. It is the **sole owner** of how a review scope and its size are
derived — leaf flows reference it and never restate it.

Resolve `REVIEW_TARGET` into the review scope:

| `REVIEW_TARGET` | Scope |
|---|---|
| empty, uncommitted changes exist | uncommitted changes only — `git diff HEAD` (staged + unstaged tracked files), plus untracked (`??`) files from `git status --porcelain`, reviewed as new code |
| empty, clean tree | branch diff against the base: `git merge-base origin/{main\|master} HEAD`, then `git diff <merge-base-sha>`, plus untracked files |
| commit hash | validate with `git rev-parse --verify`, then `git show` |
| commit range (`A..B` / `A...B`) | validate both endpoints, then `git diff A~1..B` |
| file/directory paths | verify each path exists, then the full contents of the resolved files |
| PR number or `/pull/` URL | the PR's merge-base diff, collected by `references/pr-review.md` |

The **resolved review scope**, not a diff, decides whether there is work: for a
path target it is the set of files resolved from the given paths; for every
other target it is the diff. A clean tree does not make a path target empty.
If the resolved scope is empty, show the usage examples below and exit.

Then measure what the leaf flow will actually read — a diff for diff-shaped
targets, full file text for path targets:

- **Diff-shaped targets** (uncommitted changes, branch/merge-base diff, a
  commit, a commit range, a PR): `CHANGED_LINES` is the sum of numeric
  additions and deletions from `git diff --numstat` for the complete review
  scope, and `CHANGED_FILES` is the number of unique changed paths in it.
- **File/directory path targets**: the leaf flow reviews full contents, so
  measure full contents — `CHANGED_FILES` is the number of files resolved
  from the given paths (directories expand recursively, excluding ignored
  paths), and `CHANGED_LINES` is the total line count of those files. A
  clean tree never makes a path target small by default.
- **Untracked text files** in a diff-shaped scope count as one file each with
  their full line count as additions.
- Generated files count normally in both totals; do not exclude them because
  they are generated.
- Any binary file — a binary diff (`-`/`-` in `--numstat`), an untracked
  binary, or a binary resolved from a path target — counts as a file and makes
  the scope non-small, because its line size is unknown.

Set `SMALL_SCOPE = true` only when `CHANGED_LINES <= 1000`,
`CHANGED_FILES <= 20`, and the scope contains no binary file. Both numeric
conditions must hold. `SMALL_SCOPE` is the name every flow uses for this
result.

### Usage examples

Print this list when the resolved scope is empty:

```
/gh-pr-review                      review uncommitted changes, else the branch diff
/gh-pr-review a1b2c3d              review a commit
/gh-pr-review a1b2c3d..e4f5g6h     review a commit range
/gh-pr-review src/foo.ts           review files or directories
/gh-pr-review 123                  review a PR (also accepts a /pull/ URL)
/gh-pr-review <target> fix         also apply low-risk fixes (local targets)
/gh-pr-review <pr> submit          also publish the review to GitHub
/gh-pr-review checklist            adopt this session's proposed checklist items
/gh-pr-review diag                 diagnose gaps in this skill
```

