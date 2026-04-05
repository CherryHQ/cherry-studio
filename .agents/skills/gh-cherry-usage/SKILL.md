---
name: gh-cherry-usage
description: Guide for using `gh cherry`, a GitHub CLI extension providing enhanced issue management (with type support), annotated PR diffs, and a full PR review lifecycle from the terminal. Use when the user asks how to use gh-cherry commands, wants to perform PR reviews, create typed issues, view annotated diffs, or manage review threads via the CLI.
---

# gh-cherry Usage Guide

`gh cherry` is a GitHub CLI extension that adds features not natively available in `gh`: issue types, annotated PR diffs with line numbers, and a complete review lifecycle.

Install: `gh extension install EurFelux/gh-cherry`

## Commands

### Issues

```bash
# Create an issue with a type (Bug, Feature, etc.)
gh cherry issue create -t "Title" -T Bug

# All create flags: -b body, -l label, -a assignee, -m milestone, -p project, -R owner/repo

# List available issue types
gh cherry issue types [-R owner/repo]
```

### PR Diff

```bash
# Annotated diff with L(eft)/R(ight) line numbers — useful for AI review workflows
gh cherry pr diff 123 [-R owner/repo]
```

### Reviews

Full review lifecycle from the terminal. All commands output JSON.

```bash
# Start a pending review (reuses existing if one is open)
gh cherry review start 123 [-b body | --body-file path] [-R owner/repo]

# Add inline comment to pending review
gh cherry review thread add <review-id> --path file.go --line 42 -b "comment" [--side LEFT|RIGHT] [--start-line 40 --start-side LEFT|RIGHT]

# Preview pending comments before submitting
gh cherry review preview <review-id>

# Submit the review (required: --event APPROVE|REQUEST_CHANGES|COMMENT)
gh cherry review submit <review-id> -e APPROVE [-b "LGTM" | --body-file path]

# View all reviews and threads on a PR
gh cherry review view 123 [--reviewer login] [--state STATE] [--unresolved] [--tail N] [-R owner/repo]

# Edit a submitted review's body
gh cherry review edit <review-id> -b "Updated text" [--body-file path]

# Reply to an existing review thread
gh cherry review thread reply <thread-id> -b "Fixed, thanks"

# List review threads on a PR
gh cherry review thread list 123 [--unresolved] [--mine] [-R owner/repo]

# Resolve / unresolve a thread
gh cherry review thread resolve <thread-id>
gh cherry review thread unresolve <thread-id>

# Edit a review comment
gh cherry review thread edit-comment <comment-id> -b "Updated text"

# Delete a review comment
gh cherry review thread delete-comment <comment-id>
```

### Review Workflow Example

Typical flow for reviewing a PR:

1. `gh cherry pr diff 123` — read the annotated diff
2. `gh cherry review start 123` — get a review ID
3. `gh cherry review thread add <id> --path src/main.go --line 15 -b "Nit: rename this"` — leave comments
4. `gh cherry review preview <id>` — verify comments look right
5. `gh cherry review submit <id> -e COMMENT -b "A few suggestions"` — submit

### Common Flags

| Flag | Short | Available on | Purpose |
|------|-------|-------------|---------|
| `--repo` | `-R` | start, view, thread list, pr diff, issue | Target a different repo (owner/repo) |
| `--body` | `-b` | start, submit, edit, thread add/reply/edit-comment, issue create | Inline text |
| `--body-file` | | start, submit, edit, thread add/reply/edit-comment | Read text from file (mutually exclusive with -b) |
