# Local Review

Single-agent review for small local changes (routed here by `SKILL.md` when
the diff is ≤ 1000 changed lines and ≤ 20 files). Reviews the diff and
reports confirmed issues; when the scope is a self review, low- and
medium-risk fixes are applied automatically. Never asks the user questions.

## Input from SKILL.md

- Review scope (already determined during routing; re-derive with the Step 1
  rules if invoked standalone).
- `SELF_REVIEW`: `true` for working tree / current branch / file paths;
  `false` for commit or range targets.

## References

| File | Purpose |
|------|---------|
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
| `cherry-review-guidance.md` | Cherry Studio project-specific review boundaries |
| `judgment-matrix.md` | Risk levels, worth-fixing criteria, special rules |
| `checklist-evolution.md` | Checklist update flow and rules |

---

## Step 1: Scope

Determine the diff to review based on `$ARGUMENTS` and working tree state:

- **Empty `$ARGUMENTS`**, **uncommitted changes exist**: scope is
  uncommitted changes only. Fetch with `git diff HEAD` (staged + unstaged
  tracked files). Also check for untracked files with `git status --porcelain`
  (`??` lines) and read their contents for review.
- **Empty `$ARGUMENTS`**, **no uncommitted changes**: find the base branch by
  checking common base branches in order: `main`, `master`. Use the first one
  that exists. Fetch the branch diff:
  ```
  git merge-base origin/{base_branch} HEAD
  git diff <merge-base-sha>
  ```
  Also check for untracked files with `git status --porcelain` (`??` lines).
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

---

## Step 2: Review

Review the diff. Apply `code-checklist.md` to code files,
`doc-checklist.md` to documentation files. Apply `cherry-review-guidance.md` to
code, mixed, Cherry architecture documentation, and project-skill changes:
first read the docs its "Mandatory Baseline Docs" section requires for the
touched processes, then load only the on-demand references it routes to.
Review architecture-first — settle placement, ownership, and
abstraction-integrity findings against those docs before line-level detail;
doc violations are Warning minimum. For React component changes, also consult
`vercel-react-best-practices` skill for detailed performance patterns. When
changed lines depend on surrounding context, read the relevant sections or
related definitions as needed. Untracked files have no diff — review their
full contents as new code.

If the branch has an associated GitHub PR, inspect its checks with `gh pr
checks` and include failing or pending CI in the review. Do not run `pnpm lint`,
`pnpm test`, or `pnpm format` locally during review. If no associated PR exists,
state that CI validation is unavailable and keep the result explicitly limited
to static review.

For each issue found:
- Provide a code citation (file:line + snippet) from the current tree.
- Self-verify by re-reading the code — confirm or withdraw.
- If a cited path/line no longer exists, locate the correct file/path via `git diff --name-only` or file search before reporting.

**Output rule**: only present the final confirmed issues to the user. Do not
output analysis process, exclusion reasoning, or issues that were considered
but ruled out.

---

## Step 3: Filter

Consult `judgment-matrix.md` for risk level assessment, worth-fixing criteria,
and special rules. Discard issues that are not worth reporting.

If no issues remain after filtering → report "no issues found" and exit.

---

## Step 4: Fix and report

Do not ask the user which issues to fix.

- **`SELF_REVIEW` = true**: auto-fix low- and medium-risk issues, with every
  fix at the defect's altitude per `cherry-review-guidance.md` § Fix
  Recommendation Policy. High-risk issues are reported with the proposed
  at-altitude fix, not applied.
- **`SELF_REVIEW` = false**: report all issues; edit nothing.

Present a summary of what was reviewed, the issues fixed (self review only),
and the issues reported with their proposed fixes. Do not run local lint,
test, or format commands as part of the review flow. Report that existing CI
covers the reviewed commit, not unpushed local fixes; re-check CI only after
the fixes are published through a user-authorized workflow.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
follow its steps.
