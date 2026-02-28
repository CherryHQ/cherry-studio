---
name: gh-pr-review
description: Review GitHub pull requests using the gh-pr-review extension. Use when asked to review a PR, add inline review comments, request changes, approve, or comment on a pull request. Manages the full review lifecycle — start, add inline comments, preview, and submit.
---

# GitHub PR Review

Use this skill when the user requests to review a pull request. Leverages the `gh-pr-review` CLI extension for structured, inline code reviews via GitHub's pending review API.

## Prerequisites

The `gh-pr-review` extension must be installed. If not present, install it:

```bash
gh extension install EurFelux/gh-pr-review
```

Verify with:

```bash
gh extension list | grep pr-review
```

## Workflow

### Step 1: Identify the PR

Determine the target PR from the user's request:
- A PR number (e.g., `#123`)
- A PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- The current branch (use `gh pr view --json number` to find it)

Determine the repository in `owner/repo` format. Default to the current repo via `gh repo view --json nameWithOwner -q .nameWithOwner`.

### Step 2: Gather PR Context

Collect information needed for a thorough review:

```bash
# PR metadata
gh pr view <number> --json title,body,files,additions,deletions,baseRefName,headRefName

# Full diff
gh pr diff <number>

# Changed files with diff hunks (needed for inline comment line numbers)
gh api repos/<owner>/<repo>/pulls/<number>/files --jq '.[] | {filename, status, patch}'
```

Read the changed files in the local repo to understand surrounding context beyond the diff.

### Step 3: Analyze Changes

Review the code for:
- Correctness and logic errors
- Security vulnerabilities (OWASP top 10)
- Performance issues
- Missing error handling at system boundaries
- Breaking changes or backward compatibility concerns
- Test coverage gaps
- Typos and naming inconsistencies
- Adherence to project conventions (check `CLAUDE.md` or equivalent)

Categorize findings by severity:
- **Critical**: Bugs, data loss risks, security vulnerabilities
- **Significant**: Missing error handling, architectural concerns, incomplete implementations
- **Minor/Nit**: Typos, style issues, naming suggestions

### Step 4: Start a Pending Review

```bash
gh pr-review review start --repo <owner/repo> --pr <number>
```

Save the returned `id` field — this is the `review-id` needed for all subsequent commands.

### Step 5: Add Inline Comments

For each finding, add an inline comment at the relevant location:

```bash
gh pr-review review add-comment --repo <owner/repo> --pr <number> \
  --review-id "<review-id>" \
  --path "<file-path>" \
  --line <line-number> \
  --body "<comment-body>"
```

For multi-line comments (highlighting a range of code):

```bash
gh pr-review review add-comment --repo <owner/repo> --pr <number> \
  --review-id "<review-id>" \
  --path "<file-path>" \
  --line <end-line> \
  --start-line <start-line> \
  --body "<comment-body>"
```

**Line number rules:**
- `--line` is the absolute line number in the **new file** (RIGHT side by default).
- The line must fall within a diff hunk range. Check hunk headers: `@@ -oldStart,oldCount +newStart,newCount @@` — valid range for RIGHT side is `newStart` to `newStart + newCount - 1`.
- For comments on deleted lines, use `--side LEFT` and line numbers from the old file.
- Use `gh api repos/<owner>/<repo>/pulls/<number>/files --jq '.[].patch'` to verify valid line ranges.

**Comment body guidelines:**
- Lead with a bold severity label (e.g., `**Bug:**`, `**Critical:**`, `**Nit:**`, `**Perf:**`).
- Explain the problem clearly.
- Provide a concrete suggestion with code snippet when applicable.

### Step 6: Preview the Review

Before submitting, optionally preview all pending comments:

```bash
gh pr-review review preview --repo <owner/repo> --pr <number> --review-id "<review-id>"
```

Show the preview to the user and ask for confirmation before submitting. **Skip this step if the user explicitly indicates no preview/confirmation is needed.**

### Step 7: Submit the Review

```bash
gh pr-review review submit --repo <owner/repo> --pr <number> \
  --review-id "<review-id>" \
  --event "<APPROVE|COMMENT|REQUEST_CHANGES>" \
  --body "<review-summary>"
```

Choose the event based on findings:
- `APPROVE` — No issues found, or only minor nits.
- `COMMENT` — Observations and suggestions, but nothing blocking.
- `REQUEST_CHANGES` — Critical or significant issues that must be addressed before merging.

**Review summary body guidelines:**
- Start with a brief overall assessment.
- Group findings by severity (Critical, Significant, Minor).
- Include a Positives section to acknowledge good patterns.
- Keep it concise but comprehensive.

### Step 8: Report Results

Summarize to the user:
- Review event type (approved / commented / requested changes)
- Number of inline comments added
- Key findings by category
- Link to the PR

## Managing Existing Reviews

### Reply to Review Threads

```bash
gh pr-review comments --repo <owner/repo> --pr <number> --reply-to <thread-id> --body "<reply>"
```

### Resolve/Unresolve Threads

```bash
gh pr-review threads --repo <owner/repo> --pr <number> --resolve <thread-id>
gh pr-review threads --repo <owner/repo> --pr <number> --unresolve <thread-id>
```

### Edit or Delete Pending Comments

```bash
gh pr-review review edit-comment --repo <owner/repo> --pr <number> --review-id "<review-id>" --comment-id "<comment-id>" --body "<new-body>"
gh pr-review review delete-comment --repo <owner/repo> --pr <number> --review-id "<review-id>" --comment-id "<comment-id>"
```

## Constraints

- Always start a pending review before adding comments — never use single-comment review APIs.
- Never submit a review without showing the summary to the user first, unless they explicitly waive preview.
- Never fabricate line numbers — always verify against the actual diff hunk ranges.
- Review summary and inline comments must be written in English.
- Do not add inline comments outside of diff hunk ranges — they will fail silently or error.
- Respect the repository's contribution guidelines and coding conventions.
- When reviewing, read the full changed files for context, not just the diff hunks.
