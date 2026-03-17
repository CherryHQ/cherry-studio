# Local Review

Single-agent review for local changes. Reviews the diff, presents confirmed
issues, and lets the user interactively choose which ones to fix.

## References

| File | Purpose |
|------|---------|
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
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
`doc-checklist.md` to documentation files. When changed lines depend on
surrounding context, read the relevant sections or related definitions as
needed. Untracked files have no diff — review their full contents as new code.

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

## Step 4: Report and fix

Present a summary of what was reviewed, then list all confirmed issues. Ask
which ones to fix via multi-select. Each option's label is the issue summary
(e.g., `[risk] file:line — description`). Follow the grouping rule in
`SKILL.md`: ≤4 items → one question; >4 items → group by priority or category
(each group ≤4 options), then present all groups as separate questions in a
single prompt.

If the user selects any issues, apply the fixes.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
follow its steps.
