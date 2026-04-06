---
name: gh-cherry-usage
description: Guide for using `gh cherry`, a GitHub CLI extension providing enhanced issue management (with type support), annotated PR diffs, and a full PR review lifecycle from the terminal. Use when the user asks how to use gh-cherry commands, wants to perform PR reviews, create typed issues, view annotated diffs, or manage review threads via the CLI.
---

# gh-cherry Usage Guide

`gh cherry` is a GitHub CLI extension that adds features not natively available in `gh`: issue types, annotated PR diffs with line numbers, and a complete review lifecycle.

Install: `gh extension install EurFelux/gh-cherry`

## Commands

### Issues

#### `gh cherry issue create`

Create an issue with a type (Bug, Feature, etc.)

| Flag          | Short | Type     | Required | Description                     |
| ------------- | ----- | -------- | -------- | ------------------------------- |
| `--title`     | `-t`  | string   | yes      | Issue title                     |
| `--body`      | `-b`  | string   | no       | Issue body                      |
| `--label`     | `-l`  | string[] | no       | Labels to add (repeatable)      |
| `--assignee`  | `-a`  | string[] | no       | Assignees (repeatable)          |
| `--milestone` | `-m`  | string   | no       | Milestone                       |
| `--project`   | `-p`  | string[] | no       | Projects (repeatable)           |
| `--type`      | `-T`  | string   | no       | Issue type (e.g. Bug, Feature)  |
| `--repo`      | `-R`  | string   | no       | Repository in owner/repo format |

```bash
gh cherry issue create -t "Title" -T Bug -b "Description" -l bug -a octocat
```

#### `gh cherry issue types`

List available issue types for a repository.

| Flag     | Short | Type   | Required | Description                     |
| -------- | ----- | ------ | -------- | ------------------------------- |
| `--repo` | `-R`  | string | no       | Repository in owner/repo format |

```bash
gh cherry issue types [-R owner/repo]
```

### PR Diff

#### `gh cherry pr diff <pr-number>`

Annotated diff with L(eft)/R(ight) line numbers — useful for AI review workflows.

| Flag     | Short | Type   | Required | Description                     |
| -------- | ----- | ------ | -------- | ------------------------------- |
| `--repo` | `-R`  | string | no       | Repository in owner/repo format |

```bash
gh cherry pr diff 123 [-R owner/repo]
```

### Reviews

Full review lifecycle from the terminal. All commands output JSON.

#### `gh cherry review start <pr-number>`

Start a pending review (reuses existing if one is open).

| Flag          | Short | Type   | Required | Description                                      |
| ------------- | ----- | ------ | -------- | ------------------------------------------------ |
| `--body`      | `-b`  | string | no       | Review body text                                 |
| `--body-file` |       | string | no       | Read body from file (mutually exclusive with -b) |
| `--repo`      | `-R`  | string | no       | Repository in owner/repo format                  |

```bash
gh cherry review start 123 [-b body | --body-file path] [-R owner/repo]
```

#### `gh cherry review submit <review-id>`

Submit a pending review.

| Flag          | Short | Type   | Required | Description                                         |
| ------------- | ----- | ------ | -------- | --------------------------------------------------- |
| `--event`     | `-e`  | string | yes      | Review event: APPROVE, REQUEST_CHANGES, or COMMENT  |
| `--body`      | `-b`  | string | no       | Summary text                                        |
| `--body-file` |       | string | no       | Read summary from file (mutually exclusive with -b) |

```bash
gh cherry review submit <review-id> -e APPROVE [-b "LGTM" | --body-file path]
```

#### `gh cherry review view <pr-number>`

View all reviews and threads on a PR.

| Flag           | Short | Type   | Required | Description                          |
| -------------- | ----- | ------ | -------- | ------------------------------------ |
| `--reviewer`   |       | string | no       | Filter by reviewer login             |
| `--state`      |       | string | no       | Filter by review state               |
| `--unresolved` |       | bool   | no       | Only show unresolved threads         |
| `--tail`       |       | int    | no       | Show only last N comments per thread |
| `--repo`       | `-R`  | string | no       | Repository in owner/repo format      |

```bash
gh cherry review view 123 [--reviewer login] [--state STATE] [--unresolved] [--tail N] [-R owner/repo]
```

#### `gh cherry review edit <review-id>`

Edit a submitted review's body. Exactly one of `--body` or `--body-file` is required.

| Flag          | Short | Type   | Required     | Description                                      |
| ------------- | ----- | ------ | ------------ | ------------------------------------------------ |
| `--body`      | `-b`  | string | one required | New review body                                  |
| `--body-file` |       | string | one required | Read body from file (mutually exclusive with -b) |

```bash
gh cherry review edit <review-id> -b "Updated text"
```

#### `gh cherry review preview <review-id>`

Preview pending comments before submitting. No flags.

```bash
gh cherry review preview <review-id>
```

#### `gh cherry review thread add <review-id>`

Add an inline comment to a pending review. Exactly one of `--body` or `--body-file` is required.

| Flag           | Short | Type   | Required     | Description                                      |
| -------------- | ----- | ------ | ------------ | ------------------------------------------------ |
| `--path`       |       | string | yes          | File path to comment on                          |
| `--line`       |       | int    | yes          | End line number                                  |
| `--body`       | `-b`  | string | one required | Comment text                                     |
| `--body-file`  |       | string | one required | Read body from file (mutually exclusive with -b) |
| `--side`       |       | string | no           | LEFT or RIGHT (default: RIGHT)                   |
| `--start-line` |       | int    | no           | Multi-line start line                            |
| `--start-side` |       | string | no           | Multi-line start side (LEFT or RIGHT)            |

```bash
gh cherry review thread add <review-id> --path file.go --line 42 -b "comment" [--side LEFT|RIGHT] [--start-line 40 --start-side LEFT|RIGHT]
```

#### `gh cherry review thread reply <thread-id>`

Reply to an existing review thread. Exactly one of `--body` or `--body-file` is required.

| Flag          | Short | Type   | Required     | Description                                      |
| ------------- | ----- | ------ | ------------ | ------------------------------------------------ |
| `--body`      | `-b`  | string | one required | Reply text                                       |
| `--body-file` |       | string | one required | Read body from file (mutually exclusive with -b) |

```bash
gh cherry review thread reply <thread-id> -b "Fixed, thanks"
```

#### `gh cherry review thread list <pr-number>`

List review threads on a PR.

| Flag           | Short | Type   | Required | Description                     |
| -------------- | ----- | ------ | -------- | ------------------------------- |
| `--unresolved` |       | bool   | no       | Only show unresolved threads    |
| `--mine`       |       | bool   | no       | Only show threads started by me |
| `--repo`       | `-R`  | string | no       | Repository in owner/repo format |

```bash
gh cherry review thread list 123 [--unresolved] [--mine] [-R owner/repo]
```

#### `gh cherry review thread resolve <thread-id>`

Resolve a review thread. No flags.

```bash
gh cherry review thread resolve <thread-id>
```

#### `gh cherry review thread unresolve <thread-id>`

Unresolve a review thread. No flags.

```bash
gh cherry review thread unresolve <thread-id>
```

#### `gh cherry review thread edit-comment <comment-id>`

Edit a review comment. Exactly one of `--body` or `--body-file` is required.

| Flag          | Short | Type   | Required     | Description                                      |
| ------------- | ----- | ------ | ------------ | ------------------------------------------------ |
| `--body`      | `-b`  | string | one required | New comment body                                 |
| `--body-file` |       | string | one required | Read body from file (mutually exclusive with -b) |

```bash
gh cherry review thread edit-comment <comment-id> -b "Updated text"
```

#### `gh cherry review thread delete-comment <comment-id>`

Delete a review comment. No flags.

```bash
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

| Flag          | Short | Available on                                                     | Purpose                                          |
| ------------- | ----- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `--jq`        |       | all JSON-outputting commands (all review commands)               | Filter JSON output with a jq expression          |
| `--repo`      | `-R`  | start, view, thread list, pr diff, issue create, issue types     | Target a different repo (owner/repo)             |
| `--body`      | `-b`  | start, submit, edit, thread add/reply/edit-comment, issue create | Inline text                                      |
| `--body-file` |       | start, submit, edit, thread add/reply/edit-comment               | Read text from file (mutually exclusive with -b) |

### jq Filtering Examples

```bash
# Get just the review ID after starting a review
gh cherry review start 123 --jq '.id'

# List only unresolved thread IDs
gh cherry review thread list 123 --unresolved --jq '.[].id'

# Extract reviewer names from a PR's reviews
gh cherry review view 123 --jq '.reviews[].author'
```
