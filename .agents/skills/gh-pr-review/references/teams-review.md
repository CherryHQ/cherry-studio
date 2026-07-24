# Teams Review

You are the **coordinator**. Dispatch reviewer, verifier, and fixer agents with
the runtime-provided subagent coordination tools. Never modify source files
directly. Read code only for arbitration, diagnosis, and fix verification.

Never pause to ask the user anything — the flow runs start to finish and ends
with Report. Fixing happens only in self reviews; all other invocations are
report-only.

The reviewer–verifier adversarial pair is the core quality mechanism: reviewers
find issues, verifiers challenge them. This two-party check significantly reduces
false positives. Reviewers and verifiers MUST NOT see each other's output or
share conversation history.

## Input from SKILL.md

- Review scope (already determined during routing; re-derive with the Phase 1
  rules if invoked standalone).
- `SELF_REVIEW`: `true` for working tree / current branch / file paths;
  `false` for commit or range targets. When false, skip Phase 4 entirely —
  every confirmed issue is reported, none is fixed.

## References

| File | Purpose |
|------|---------|
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
| `cherry-review-guidance.md` | Cherry Studio project-specific review boundaries |
| `judgment-matrix.md` | Risk levels, worth-fixing criteria, special rules |
| `checklist-evolution.md` | Checklist update flow and rules |

## Flow

```
Self review:  Scope → Review → Filter → Fix/Validate → Report
Report-only:  Scope → Review → Filter → Report
```

- **Filter** routes low/medium-risk issues to Fix/Validate (self review only);
  high-risk issues go straight to Report with their proposed fix. If nothing
  is fixable, skip directly to Report.

---

## Phase 1: Scope

Determine the diff to review based on `$ARGUMENTS` and working-tree state:

- **Empty arguments**, **uncommitted changes exist**: scope is uncommitted
  changes only. Fetch with `git diff HEAD` (staged + unstaged tracked files).
  Also check `git status --porcelain` for untracked (`??`) files and review
  their full contents as new code.
- **Empty arguments**, **no uncommitted changes**: find the base branch by
  checking common base branches in order: `main`, `master`. Use the first one
  that exists. Fetch the branch diff:
  ```
  git merge-base origin/{base_branch} HEAD
  git diff <merge-base-sha>
  ```
  (On main/master itself this diff is empty → usage examples below.)
- **Commit hash** (e.g., `abc123`): validate with `git rev-parse --verify`,
  then `git show`.
- **Commit range** (e.g., `abc123..def456` or `abc123...def456`): validate both
  endpoints. Fetch the diff including both endpoints:
  ```
  git diff A~1..B
  ```
- **File/directory paths**: verify all paths exist on disk, then read file
  contents.

If diff is empty → show usage examples and exit:
`/gh-pr-review` (uncommitted changes or current branch),
`/gh-pr-review a1b2c3d`, `/gh-pr-review a1b2c3d..e4f5g6h`,
`/gh-pr-review src/foo.ts`, `/gh-pr-review 123`,
`/gh-pr-review https://github.com/.../pull/123`.

### Associated PR comments

If `gh` is available, check whether the current branch has an open PR:
```
gh pr view --json number,state --jq 'select(.state == "OPEN") | .number' 2>/dev/null
```
If an open PR exists, fetch its line-level review comments:
```
gh api repos/{owner}/{repo}/pulls/{number}/comments
```
Store as `PR_COMMENTS` for verification in the review step.

Also inspect its CI checks with `gh pr checks`. Record failing, pending, and
successful checks as review evidence. Do not run local lint, test, or format
commands during review.

### CI baseline

When an associated PR exists, use `gh pr checks` as the validation baseline and
record failing or pending jobs. If no PR exists, state that CI validation is
unavailable and continue with static review only. Never substitute a local
`pnpm lint`, `pnpm test`, or `pnpm format` run.

### Module partition

Partition files in scope into **review modules** for parallel review. Each
module is a self-contained logical unit. Split large files by section/function
group; group related small files together. Classify each module as `code`,
`doc`, or `mixed`.

Suggested module boundaries for this project:
- `src/main/data/` — DataApi handlers, data services, migrations, schemas
- `src/main/core/` — lifecycle, application, windows, paths, logger
- `src/main/services/` — Main-process business services and side effects
- `src/renderer/data/` — DataApi hooks, Cache, Preference, renderer stores
- `src/renderer/` — React UI components, hooks, pages, features, windows
- `packages/aiCore/` — AI SDK middleware & providers
- `src/shared/` — Cross-process primitives, DataApi/IpcApi schemas, types, pure utilities
- `packages/ui/` — Shared UI primitives
- `src/shared/ipc/`, `src/main/ipc/`, `src/preload/`, `src/renderer/ipc/` — IpcApi contract and bridge
- `docs/references/data/` — Data architecture documentation
- `.agents/skills/` — Agent skills and review instructions

### Issue tracking

The coordinator tracks all issues in memory throughout the session. Each issue
has:
- Brief description
- Status: `reported` | `fixed` | `failed`
- Risk: low | medium | high
- File: file path:line
- Proposed fix (medium/high risk only)

---

## Phase 2: Review

### Agent setup

Launch agents with the coordination tools exposed by the current runtime:

- One independent reviewer per module.
- One fresh independent **verifier**, launched after all reviewers complete.

Do not prescribe tool names, agent types, or parameters the runtime does not
expose. Keep reviewer and verifier contexts separate; pass tasks through the
runtime's spawn/delegate interface and collect their returned reports.

**Module merging**: if the total diff is ≤1000 changed lines AND ≤20 files,
merge all modules into a single reviewer. The overhead of multiple agents
(startup, coordination, forwarding) outweighs the parallelism benefit at
this scale.

Launch reviewers concurrently when the runtime supports parallel subagents.
If it cannot run subagents in parallel, launch the same agents sequentially —
phases, prompts, and reviewer/verifier context separation are unchanged. If
the runtime has no subagent capability at all, perform the phases yourself in
order, replacing the verifier with an explicit adversarial self-verification
pass over every finding before Phase 3.

### Reviewer prompt

Stance: **thorough** — discover as many real issues as possible, self-verify
before submitting.

Each reviewer receives:
- **Scope**: file list + changed line ranges for its module. Reviewers fetch
  diffs and read additional context themselves as needed — coordinator does NOT
  pass raw diff or file contents.
- **Checklist**: `code-checklist.md` for code, `doc-checklist.md` for doc, both
  for mixed. Include the checklist content verbatim in the reviewer prompt.
  Include `cherry-review-guidance.md` verbatim for code, mixed, architecture
  documentation, and project-skill modules. For doc-only modules outside Cherry
  architecture/policies, include it only when the document describes project
  behavior, paths, tools, or review rules.
  For React/performance-heavy modules, also include relevant rules from
  `vercel-react-best-practices` skill as supplementary checks.
- **Mandatory docs**: before reviewing, read the docs required by
  `cherry-review-guidance.md` § Mandatory Baseline Docs for the processes the
  module touches, plus its on-demand docs for touched subsystems. Review
  architecture-first — placement, ownership, and abstraction integrity against
  those docs before line-level detail. Any non-conformance with them is a
  finding at Warning minimum.
- **Evidence requirement**: every issue must have a code citation (file:line +
  snippet) from the current tree.
- **Checklist exclusion**: see the exclusion section in the corresponding
  checklist. Project rules loaded in context take priority.
- **Self-check**: before submitting, re-read the relevant code and verify each
  issue. Mark as confirmed or withdrawn. Only submit confirmed issues. If a cited
  path/line no longer exists, locate the correct file/path via `git diff --name-only`
  or file search before reporting.
- **Output format**: `[file:line] [A/B/C] — [description] — [key lines]`

**PR comment reviewer** (when `PR_COMMENTS` exist): one additional agent to
verify PR review comments against current code. Same output format, same
verification pipeline.

### Verification

Stance: **adversarial** — default to doubting the reviewer, actively look for
reasons each issue is wrong. Reject with real evidence, confirm if it holds up.
This step is mandatory — the coordinator MUST NOT skip it or perform
verification itself. **Exception**: if every reviewer explicitly reports zero
issues (LGTM / no issues found), skip verification and proceed directly to
Phase 3.

After all reviewer agents complete, collect their findings. Launch a single
verifier agent with ALL findings combined. Include the following verbatim in
the verifier's prompt:

```
You are a code review verifier. Your stance is adversarial — default to doubting the
reviewer's conclusion and actively look for reasons why the issue might be wrong. Your
job is to stress-test each issue so that only real problems survive.

For each issue you receive:

1. Read the cited code (file:line) and sufficient surrounding context.
2. Actively try to disprove the issue: Is the reviewer's reasoning flawed? Is there
   context that makes this a non-issue (e.g., invariants guaranteed by callers, platform
   constraints, intentional design)? Does the code actually behave as the reviewer
   claims? Look for the strongest counter-argument you can find.
3. Output for each issue:
   - Verdict: REJECT or CONFIRM
   - Reasoning: for REJECT, state the concrete counter-argument. For CONFIRM, briefly
     note what you checked and why no valid counter-argument exists.

Important constraints:
- Your counter-arguments must be grounded in real evidence from the code. Do not
  fabricate hypothetical defenses or invent caller guarantees that are not visible in
  the codebase.
- A CONFIRM verdict is not a failure — it means the reviewer found a real issue and
  your challenge validated it.
```

### After review

Before entering Phase 3, confirm: (1) all reviewers have submitted their final
reports; (2) the verifier has given a CONFIRM/REJECT verdict for every finding,
OR all reviewers reported zero issues and verification was skipped.

---

## Phase 3: Filter — coordinator only

Your stance here is **neutral** — trust no single party. Treat reviewer reports
and verifier rebuttals as equally weighted inputs. Use your project-wide view to
consider cross-module impact, conventions, and architectural intent that local
reviewers may miss.

### 3.1 De-dup

Remove cross-reviewer duplicates (same location, same topic).

### 3.2 Existence check

| Verifier verdict | Action |
|-----------------|--------|
| CONFIRM | Plausibility check — verify description matches cited code. Read code if anything looks off. |
| REJECT | Read code. Evaluate both arguments. Drop only if counter-argument is sound. |

### 3.3 Risk level

Consult `judgment-matrix.md` for risk level assessment, worth-fixing criteria,
handling by risk level, and special rules.

**Fix approach** (Medium/High only): specify the chosen approach and reasoning.
Record in the issue's `Proposed` field. Low risk: single obvious fix, no guidance.
Every proposed fix must sit at the defect's altitude per
`cherry-review-guidance.md` § Fix Recommendation Policy: minimal correction
for local bugs, root-cause fix for structural symptoms, architecture-conformant
relocation for boundary/entity-leakage issues. A below-altitude patch (side
table, metadata flag, extra special case, symptom-only fix for a structural
cause) must not enter the auto-fix queue; report the issue with the
at-altitude fix as the recorded proposal instead.

### 3.4 Route

All confirmed issues are recorded with risk level.

| Condition | → |
|-----------|---|
| Low or medium risk, `SELF_REVIEW` = true | auto-fix queue |
| High risk, or `SELF_REVIEW` = false | `reported` (with proposed fix) |

- Cross-module impact: if a fix requires updates outside the fixer's module,
  add it to the current fix queue and assign to the appropriate fixer.

Phase 4 if the auto-fix queue is non-empty; otherwise jump to Phase 5
(Report). Never ask the user which issues to fix.

---

## Phase 4: Fix/Validate

Runs only when `SELF_REVIEW` is true and the auto-fix queue is non-empty.

### Fix

Stance: **precise** — apply each fix completely and correctly, never expand
scope. The coordinator MUST NOT apply fixes directly.

**Agent assignment**: launch fixer agents with the runtime-provided coordination
tools. Prefer reusing an existing reviewer only when the runtime preserves that
agent's context; otherwise start a fixer with the minimum verified issue context:

- Issue in a file that a reviewer already analyzed → include that context in the
  fixer prompt.
- Cross-module issues → single fixer agent with all relevant file paths.
- Multi-file renames → single atomic task assigned to one agent.

One agent may receive multiple fix tasks if it covers several files. Avoid
assigning the same file to multiple agents to prevent concurrent edit conflicts.

Each fixer receives (include verbatim in every fixer prompt):

```
Fix rules:
1. Do not stage or commit. The coordinator validates all edits before any commit.
2. Only modify files explicitly assigned by the coordinator.
3. If a fix requires changes to unassigned files, stop and report to the coordinator
   for re-assignment.
4. Keep each issue's edits separable and report the exact changed files.
5. When in doubt, skip the fix rather than risk a wrong change.
6. Do not run build or tests.
7. Do not modify public API function signatures or class definitions (comments are OK),
   unless the coordinator's issue description explicitly requires an API signature fix.
8. After each fix, check whether the change affects related comments or documentation
   within your assigned files (function/class doc-comments, inline comments describing
   the changed logic). If so, update them as part of the same fix.
   Cross-module documentation updates (README, spec files, other modules) are handled
   separately by the coordinator.
9. When done, report the changed files for each fix and list any skipped issues
   with the reason for skipping.
```

Fixers leave all edits uncommitted. The review workflow never stages or commits
fixes: repository policy requires local validation before a commit, while code
review is CI-only. Hand verified patches to a separate user-authorized
publish/commit workflow; that workflow owns the required local checks,
Conventional Commit with a specific kebab-case scope, and `--signoff`. Never
stage pre-existing user changes.

### Verify fixes (coordinator)

Wait for all fixers. Before running validation, the coordinator reads the
working-tree diff for every assigned file and verifies:
1. The fix correctly addresses the original issue
2. No new issues introduced (naming inconsistencies, missing updates in
   surrounding code, logic errors)
3. Fix scope matches the issue — no unintended changes

If a problem is found, launch a correction agent with specific details
(max 1 retry). If the retry fails, mark it `failed`; never discard pre-existing
user changes while removing an unsuccessful fixer edit.

### Validate fixes

Re-read every fixer diff and repeat the relevant reviewer/verifier checks. Do
not run local lint, test, format, or build commands. Existing CI validates the
reviewed remote commit and does not cover unpushed fixes; state that limitation
in the report. If a later user-authorized publish workflow pushes the fixes,
inspect the resulting CI before claiming them fully validated.

- **Static verification passes** → mark issues `fixed`, with CI pending when
  the fix is not yet published.
- **Static verification fails** → retry via a correction agent with failure
  details (max 2 retries). If still unresolved, mark the issue `failed` and ask
  before removing its exact patch; never reset, checkout, or otherwise discard
  unrelated or pre-existing changes.

### After validation

Proceed to Phase 5 (Report). Failed fixes are reported, not retried with the
user; never discard pre-existing user changes while removing an unsuccessful
fixer edit.

---

## Phase 5: Report

Summary:
- Issues found / fixed (self review only) / reported / failed
- Reported issues listed with risk, `file:line`, and the proposed
  at-altitude fix (`cherry-review-guidance.md` § Fix Recommendation Policy)
- Rolled-back issues and reasons
- Associated PR CI status, or "unavailable" when there is no PR
- Unpushed fixes: static verification only, CI pending
- Issues from PR comments (when `PR_COMMENTS` existed)
- Note: "To verify fix quality, run `/gh-pr-review` again."

### Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
follow its steps.
