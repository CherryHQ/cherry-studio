# PR Review

PR review uses **Worktree mode** — fetch the PR branch locally so review can
read related code across modules, at the exact version of the PR branch. This
is critical for review accuracy.

## Input from SKILL.md

- `AUTHORIZED_SUBMIT`: `true` only when the invocation explicitly requested
  publishing the review (`submit` modifier or equivalent user wording).
  Default `false` — findings are reported to the user; nothing is written to
  GitHub.
- `HAS_SUBAGENTS`: runtime capability determined by `SKILL.md` § Route. It is
  `true` only when independent reviewer and verifier agents can be launched;
  parallel execution is not required.

## References

| File | Purpose |
|------|---------|
| `consumer-review.md` | Consumer review stage (feat-shaped changes) |
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

Only after the worktree, `PR_BODY`, existing review comments, and CI state have
all been collected, calculate `CHANGED_LINES`, `CHANGED_FILES`, binary status,
and `SMALL_SCOPE` from the complete merge-base diff using the canonical
definition in `SKILL.md` § Route. Do not use GitHub's summary counts or a
module-merge heuristic as a substitute.

---

## Step 3: Review

Select exactly one review engine:

- `SMALL_SCOPE = true` → `references/local-review.md`.
- `SMALL_SCOPE = false` and `HAS_SUBAGENTS = true` →
  `references/teams-review.md`.
- `SMALL_SCOPE = false` and `HAS_SUBAGENTS = false` →
  `references/local-review.md` with `LIMITED_SINGLE_AGENT = true`.

Run the selected engine inside `REVIEW_DIR` with `AUTHORIZED_FIX = false`; PR
review never edits code. For local-review, reuse the already collected scope
and run its Review and Filter steps. For teams-review, partition the scope per
its Phase 1 "Module partition", then run Phase 2 and the de-dup, existence, and
risk assessment portions of Phase 3. Do not enter teams-review at all when
`HAS_SUBAGENTS = false`: coordinator self-verification is not a substitute for
an independent reviewer–verifier pair. PR wrapper Step 4 owns final report and
submission packaging for either engine.

Coordinator duties around the selected engine:

0. Run the **Product Demand gate** (`SKILL.md` § Review Stages, stage 1)
   before implementation review, using `PR_BODY` and the diff. First inspect
   the actual semantics; skip silently only when they have no product impact.
   Interactive mode is the default regardless of PR authorship or decision
   ownership: explain the semantic effect and ask the current user for the
   product decision. A rejected direction stops the review before code findings
   are produced. Use record-only automated behavior only when the invocation
   prompt or workflow context explicitly identifies an automated run; then
   carry impact, direction, and open product questions into the Step 4 report
   and, when submitting, the review body as awaiting human confirmation.
   This coordinator gate satisfies stage 1 for the selected engine; do not run
   it a second time inside local-review or teams-review.
1. Read `PR_BODY` to understand the stated motivation and include it in
   the review context. Verify the implementation actually achieves what the
   author describes.
2. Apply the selected engine's checklist and reference-loading rules, including
   `cherry-review-guidance.md` and mandatory baseline docs read from the
   worktree, reviewing architecture-first.
3. When `PR_COMMENTS` exist, verify whether previously raised issues have been
   fixed. In teams-review this uses its additional PR-comment reviewer; in
   local-review the single reviewer performs the check directly.
4. After verification, de-duplicate confirmed issues against existing PR
   comments.

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
- When `LIMITED_SINGLE_AGENT = true`: explicitly disclose that a non-small PR
  received single-agent review without independent adversarial verification
  because the runtime has no subagent capability.
- Checklist candidates: include any valid recurring-pattern candidates as
  `proposed`; regular PR review never accepts, inserts, or claims to persist
  checklist rules.

If no issues → report that the review found no issues and stop. Do not submit
an approval and do not merge; only run these when the user explicitly asks
afterwards:

```bash
gh pr-review review start --repo {OWNER_REPO} --pr {number}
# Save the returned review-id
gh pr-review review submit --repo {OWNER_REPO} --pr {number} \
  --review-id "<review-id>" --event "APPROVE" --body "LGTM"
gh pr merge {number} --squash --delete-branch
```

If issues found → present them to the user in the following format:

```
{N}. [{priority}] {file}:{line} — {description and fix guidance}
```

Where `{priority}` is the checklist item ID (e.g., A2, B1, C7).
For Medium/High risk, fix guidance lists feasible options, key trade-offs, and
an optional reviewer recommendation; it never presents an option as chosen.

- **`AUTHORIZED_SUBMIT` = false** (default): stop here — no GitHub writes.
  If the user then asks to submit, that grants authorization; continue below.
- **`AUTHORIZED_SUBMIT` = true**: submit **all** confirmed issues via the
  flow below, with no per-comment selection question.

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
   Use the preview as a self-check — every comment anchors to a valid diff
   line and the set matches the confirmed issues. Do not ask the user for
   confirmation.

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

Summary of issues found / submitted.

---

## Step 5: Checklist evolution

Review all confirmed issues from this session. If any represent a recurring
pattern not covered by the current checklist, read `checklist-evolution.md` and
follow its steps.
