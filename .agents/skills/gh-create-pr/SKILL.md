---
name: gh-create-pr
description: Create or update GitHub pull requests using the repository-required workflow and template compliance. Use when asked to create/open/update a PR so the assistant reads `.github/pull_request_template.md`, fills every template section, preserves markdown structure exactly, and marks missing data as N/A or None instead of skipping sections.
---

# GitHub PR Creation

## Workflow

1. Read `.github/pull_request_template.md` before drafting the PR body.
2. Collect PR context from the current branch (base/head, scope, linked issues, testing status, breaking changes, release note content). Resolve the live base and run `pnpm change:scope --base <verified-base-ref>`; do not infer scope from the latest commit alone.
3. Read `.agents/notes/README.md` and classify the change:
   - Fill `Agent Note` with the repository path, or `N/A — <reason>` for a local/mechanical change.
   - For a Spec PR, fill `Spec PR: This PR` and list every AC.
   - For an implementation layer, link the Spec PR and list only the AC IDs covered by this layer. Verify an `APPROVED` review whose `commit_id` equals the current Spec head; a stale approval does not authorize implementation.
   - For a direct bug fix with durable rationale, link its implemented `bug-fix` note and use `Spec PR: N/A`.
4. Fill `Verification` with commands and scenarios actually run. Never present a planned, pending, skipped, or CI-only check as passed.
5. Check if the current branch has been pushed to remote. If not, push it first:
   - Default remote is `origin`, but ask the user if they want to use a different remote.
   ```bash
   git push -u <remote> <head-branch>
   ```
6. Determine the base branch:
   - For official repo(CherryHQ/cherry-studio) as `origin`: default base is `main` from `origin`, but allow the user to explicitly indicate a base branch.
   - `main` is the active v2 development line. v1 maintenance fixes (head branch `hotfix/*`, critical user-facing bug fixes only) must target `v1`, not `main` — set the base to `v1` for these.
   - For fork repo as `origin`: check available remotes with `git remote -v`, default base may be `upstream/main` or another remote. Always assume that user wants to merge head to CherryHQ/cherry-studio/main, unless the user explicitly indicates a base branch.
   - Ask the user to confirm the base branch if it's not the default.
7. Create a temp file and write the PR body using a single Bash heredoc
   (avoids `mktemp` + `Write` tool path-mismatch on Windows):
   ```bash
   pr_body_file="/tmp/gh-pr-body-$(date +%s).md"
   cat > "$pr_body_file" <<'EOF'
   ...filled template body...
   EOF
   ```
   Fill content using the template structure exactly (keep section order,
   headings, checkbox formatting). If not applicable, write `N/A` or `None`.
8. Preview the temp file content via Bash `cat "$pr_body_file"` (the `Read`
   tool can fail on `/tmp/...` paths on Windows). Show the file path and ask
   for explicit confirmation before creating. Skip if the user explicitly
   waives preview (automation workflows).
9. After confirmation, create the PR:
   ```bash
   gh pr create --base <base> --head <head> --title "<title>" --body-file "$pr_body_file"
   ```
10. Clean up the temp file: `rm -f "$pr_body_file"`
11. Report the created PR URL and summarize title/base/head, Agent Note/Spec, AC coverage, actual verification, and any required follow-up.

## Constraints

- Never skip template sections.
- Never rewrite the template format.
- Keep content concise and specific to the current change set.
- PR title and body must be written in English.
- Never create the PR before showing the full final body to the user, unless they explicitly waive the preview or confirmation.
- Never rely on command permission prompts as PR body preview.
- Never publish an implementation PR as ready when its current Spec head lacks an exact-head Approval. A Spec may remain unmerged and serve as the stack base.
- Every PR fills `Agent Note`, `Spec PR`, and `Acceptance criteria`; `N/A` requires a concise reason.
- **Release note & Documentation checkbox** — both are driven by whether the change is **user-facing**. Use the table below:

  | Change type | Release note | Docs `[x]` |
  |---|---|---|
  | New user-facing feature / setting / UI | Describe the change | ✅ |
  | Bug fix visible to users | Describe the fix | ✅ if behavior changed |
  | Behavior change / default value change | Describe + `action required` | ✅ |
  | Security fix in a user-facing dependency | Describe the fix | ✅ if usage changed |
  | CI / GitHub Actions changes | `NONE` | ❌ |
  | Internal refactoring (user cannot tell) | `NONE` | ❌ |
  | Dev / build tooling changes | `NONE` | ❌ |
  | Dev-only dependency bump | `NONE` | ❌ |
  | Test-only / code style changes | `NONE` | ❌ |

## Command Pattern

```bash
# read template
cat .github/pull_request_template.md

# show this full Markdown body in chat first
pr_body_file="/tmp/gh-pr-body-$(date +%s).md"
cat > "$pr_body_file" <<'EOF'
...filled template body...
EOF
cat "$pr_body_file"

# run only after explicit user confirmation
gh pr create --base <base> --head <head> --title "<title>" --body-file "$pr_body_file"
rm -f "$pr_body_file"
```
