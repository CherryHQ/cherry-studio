# PR Review

PR review uses **Worktree mode** — fetch the PR branch locally so review can
read related code across modules, at the exact version of the PR branch. This
is critical for review accuracy.

## References

| File | Purpose |
|------|---------|
| `code-checklist.md` | Code review checklist |
| `doc-checklist.md` | Document review checklist |
| `cherry-review-guidance.md` | Cherry Studio project-specific review boundaries and reference routing |
| `judgment-matrix.md` | Worth-fixing criteria and special rules |
| `checklist-evolution.md` | Checklist update flow and rules |

---

## Step 1: Create worktree

If `$ARGUMENTS` is a URL, extract the PR number from it.

Validate PR target:
```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
gh pr view {number} --json headRefName,baseRefName,headRefOid,state,body
```
Record `OWNER_REPO`. Extract: `PR_BRANCH`, `BASE_BRANCH`, `HEAD_SHA`, `STATE`,
`PR_BODY`.
If either command fails, inform the user and abort.
If `$ARGUMENTS` is a URL containing `{owner}/{repo}`, verify it matches
`OWNER_REPO`. If not, inform the user that cross-repo PR review is not
supported and abort.
If `STATE` is not `OPEN`, inform the user and exit.

Always create an isolated detached worktree. Never reuse the caller's current
worktree, even when its branch and HEAD match the PR: review must read the exact
remote PR snapshot without mixing in caller-side uncommitted changes. Use a
PR-and-SHA-specific path so unrelated review worktrees are never swept or
deleted. Record the absolute path `/tmp/pr-review-{number}-{short_HEAD_SHA}`
as `REVIEW_DIR` and the caller repository's `git rev-parse --show-toplevel`
result as `MAIN_REPO_DIR` in coordinator state; do not rely on shell variables
or `cd` persisting across tool calls.

Before adding, check whether that exact path is already registered with
`git worktree list --porcelain`. If it exists, reuse it only when it points to
`HEAD_SHA` and `git -C {REVIEW_DIR} status --porcelain` is empty. Never remove
or overwrite a dirty, mismatched, or unrelated worktree without user approval.
Otherwise create it:
```bash
git fetch origin pull/{number}/head
git worktree add --detach "{REVIEW_DIR}" "{HEAD_SHA}"
```

If the fetch fails with `couldn't find remote ref`, the local `origin` is
likely a fork (typical for contributors). Inspect remotes and retry against
`upstream`:
```bash
git remote -v
# If `origin` points to your fork and `upstream` points to the canonical
# repo, fetch from upstream instead:
git fetch upstream pull/{number}/head
git worktree add --detach "{REVIEW_DIR}" "{HEAD_SHA}"
```
If `upstream` is not configured, ask the user for the canonical remote URL
before retrying. Do not guess.

If worktree creation fails for any other reason, inform the user and abort.

For later review and validation filesystem/command calls, pass the recorded
absolute `REVIEW_DIR` as the explicit working directory. For shell snippets
that cannot set a working directory, use `git -C "{REVIEW_DIR}" ...`. Never
assume a prior `cd`, environment variable, or shell session still exists.
Cleanup is the exception: run it from `MAIN_REPO_DIR`, never from inside the
worktree being removed.

> **Platform note (Windows)**: If the active runtime cannot read the Git Bash
> `/tmp/...` path, convert the recorded `REVIEW_DIR` with `cygpath -w` before
> passing it to filesystem tools. On macOS/Linux, use the path as-is.

---

## Step 2: Collect diff and context

```bash
git -C "{REVIEW_DIR}" fetch origin {BASE_BRANCH}
git -C "{REVIEW_DIR}" merge-base origin/{BASE_BRANCH} HEAD
git -C "{REVIEW_DIR}" diff <merge-base-sha>
```
If the diff exceeds 200 lines, first run `git diff --stat` to get an overview,
then read the diff per file using `git -C "{REVIEW_DIR}" diff -- {file}` to
avoid output truncation.

If diff is empty → clean up worktree and exit.

Fetch existing PR review comments for de-duplication:
```bash
gh api repos/{OWNER_REPO}/pulls/{number}/comments
```

Inspect CI with:
```bash
gh pr checks {number} --repo {OWNER_REPO}
```
Record failing, pending, and successful checks as the review's validation
signal. Do not replace CI with local lint, test, or format runs.

---

## Step 3: Review

**Internal analysis**:

1. Based on the diff, read relevant code context as needed to understand the
   change's correctness (e.g., surrounding logic, base classes, callers).
2. Read `PR_BODY` to understand the stated motivation. Verify the
   implementation actually achieves what the author describes.
3. Apply `code-checklist.md` to code files and `doc-checklist.md` to
   documentation files. Apply `cherry-review-guidance.md` to code, mixed,
   Cherry architecture documentation, and project-skill changes, loading only
   the internal references it routes to for the changed areas. For React
   component changes, also consult `vercel-react-best-practices` for detailed
   performance patterns. Use `judgment-matrix.md` to decide whether each issue
   is worth reporting.
4. Check whether issues raised in previous PR comments have been fixed.
5. For each potential issue, perform a second-pass verification: re-read the
   surrounding code and check — is there a guard or early return elsewhere
   that handles this? Does the call chain guarantee preconditions? Am I
   misunderstanding lifetime or ownership?
6. **Discard all ruled-out issues. Keep only issues confirmed to exist.**
7. De-duplicate confirmed issues against existing PR comments.

**Output rule**: only present the final confirmed issues to the user. Do not
output analysis process, exclusion reasoning, or issues that were considered
but ruled out.

---

## Step 4: Clean up and report

If a worktree was created, clean it up:
```bash
git -C "{MAIN_REPO_DIR}" worktree remove "{REVIEW_DIR}"
```

> **Cleanup is best-effort.** If `git worktree remove` fails (e.g.,
> `Permission denied` on Windows when a file handle is still open), the
> review result is still valid — do not block on cleanup. From the main
> repo, run `git worktree prune` to clear stale worktree references; the
> directory can be removed manually afterward. Never force-remove a worktree
> containing unexplained changes; inspect it and request approval first.

Present results to user:
- Summary: one paragraph describing the purpose and scope of the change.
- Overall assessment: code quality evaluation and key improvement directions.
- Issue list (or "no issues found" if clean).

If no issues → ask whether to submit an approval review AND merge the PR:

1. Submit Approval:
   ```bash
   gh pr-review review start --repo {OWNER_REPO} --pr {number}
   # Save the returned review-id
   gh pr-review review submit --repo {OWNER_REPO} --pr {number} \
     --review-id "<review-id>" --event "APPROVE" --body "LGTM"
   ```

2. Merge (squash):
   ```bash
   gh pr merge {number} --squash --delete-branch
   ```

If the user declines, do nothing. Skip the comment submission below.

If issues found → present confirmed issues to user in the following format:

```
{N}. [{priority}] {file}:{line} — {description of the problem and suggested fix}
```

Where `{priority}` is the checklist item ID (e.g., A2, B1, C7). Then ask the
user to select which issues to submit using **a single multi-select question**
where each option's label is the issue summary (e.g.,
`[A2] file:line — description`). User checks multiple options in one prompt.
Unchecked issues are skipped.

### Prerequisites

The `gh-pr-review` extension must be installed. If not present, install it:
```bash
gh extension install EurFelux/gh-pr-review
```

### Submit review via gh-pr-review

Use the `gh-pr-review` extension for structured pending reviews with inline
comments. Do not use `gh pr comment` or raw `gh api` for review submission.

1. Start a pending review:
   ```bash
   gh pr-review review start --repo {OWNER_REPO} --pr {number}
   ```
   Save the returned `id` as `REVIEW_ID`.

2. Add inline comments for each selected issue:
   ```bash
   gh pr-review review add-comment --repo {OWNER_REPO} --pr {number} \
     --review-id "{REVIEW_ID}" \
     --path "{file_path}" \
     --line {line_number} \
     --body "**[{priority}]** {description and suggested fix}"
   ```
   For multi-line ranges:
   ```bash
   gh pr-review review add-comment --repo {OWNER_REPO} --pr {number} \
     --review-id "{REVIEW_ID}" \
     --path "{file_path}" \
     --line {end_line} --start-line {start_line} \
     --body "**[{priority}]** {description and suggested fix}"
   ```

3. Preview before submitting:
   ```bash
   gh pr-review review preview --repo {OWNER_REPO} --pr {number} \
     --review-id "{REVIEW_ID}"
   ```
   Show preview to user and ask for confirmation. Skip if user explicitly
   waives preview.

4. Submit the review:
   ```bash
   gh pr-review review submit --repo {OWNER_REPO} --pr {number} \
     --review-id "{REVIEW_ID}" \
     --event "<COMMENT|REQUEST_CHANGES>" \
     --body "{review summary}"
   ```
   Choose event based on severity:
   - `COMMENT` — observations and suggestions, nothing blocking
   - `REQUEST_CHANGES` — critical or significant issues that must be addressed

**Line number rules:**
- `--line` is the absolute line number in the **new** file (RIGHT side). Must
  be determined during Step 3 by reading the actual file in the worktree — do
  not derive from diff hunk offsets.
- The line must fall within a diff hunk range. Check hunk headers:
  `@@ -oldStart,oldCount +newStart,newCount @@` — valid range for RIGHT side
  is `newStart` to `newStart + newCount - 1`.
- For comments on deleted lines, use `--side LEFT` and line numbers from the
  old file.

**Comment body guidelines:**
- Lead with a bold severity/priority label (e.g., `**[A2]**`, `**[B1]**`).
- Explain the problem clearly.
- Provide a concrete suggestion with code snippet when applicable.
- Write in the user's conversation language.

Summary of issues found / submitted / skipped.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
follow its steps.
