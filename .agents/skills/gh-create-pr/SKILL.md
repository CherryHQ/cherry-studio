---
name: gh-create-pr
description: Create or update GitHub pull requests using the repository-required workflow and template compliance. Use when asked to create/open/update a PR so the assistant reads `.github/pull_request_template.md`, fills every template section, preserves markdown structure exactly, and marks missing data as N/A or None instead of skipping sections.
---

# GitHub PR Creation

## Workflow

1. Read `.github/pull_request_template.md` before drafting the PR body.
2. Collect PR context from the current branch (base/head, scope, linked issues, testing status, breaking changes, release note content).
3. Check if the current branch has been pushed to remote. If not, push it first:
   - Default remote is `origin`, but ask the user if they want to use a different remote.
   ```bash
   git push -u <remote> <head-branch>
   ```
4. Determine the base branch:
   - For official repo(CherryHQ/cherry-studio) as `origin`: default base is `main` from `origin`, but allow the user to explicitly indicate a base branch.
   - `main` is the active development line, including hotfix PRs. Do not target an old maintenance branch unless the user explicitly requests it.
   - Only classify a PR as a release hotfix when the user explicitly says it must be included in the active draft release. Use the title `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>` and the `hotfix` label. The label is also synchronized automatically from the title by `backport-release-fixes.yml`.
   - For fork repo as `origin`: check available remotes with `git remote -v`, default base may be `upstream/main` or another remote. Always assume that user wants to merge head to CherryHQ/cherry-studio/main, unless the user explicitly indicates a base branch.
   - Ask the user to confirm the base branch if it's not the default.
5. Create a temp file and write the PR body using a single Bash heredoc
   (avoids `mktemp` + `Write` tool path-mismatch on Windows):
   ```bash
   pr_body_file="/tmp/gh-pr-body-$(date +%s).md"
   cat > "$pr_body_file" <<'EOF'
   ...filled template body...
   EOF
   ```
   Fill content using the template structure exactly (keep section order,
   headings, checkbox formatting). If not applicable, write `N/A` or `None`.
6. Preview the temp file content via Bash `cat "$pr_body_file"` (the `Read`
   tool can fail on `/tmp/...` paths on Windows). Show the file path and ask
   for explicit confirmation before creating. Skip if the user explicitly
   waives preview (automation workflows).
7. After confirmation, create the PR:
   ```bash
   gh pr create --base <base> --head <head> --title "<title>" --body-file "$pr_body_file"
   ```
   For a release hotfix, ensure the repository label exists and create the PR with it:
   ```bash
   gh label create hotfix --color D73A4A --description "Urgent fix for the active draft release" --force
   gh pr create --base main --head <head> --title "hotfix(<scope>): <description>" --label hotfix --body-file "$pr_body_file"
   ```
8. Clean up the temp file: `rm -f "$pr_body_file"`
9. Report the created PR URL and summarize title/base/head and any required follow-up.

## Constraints

- Never skip template sections.
- Never rewrite the template format.
- Keep content concise and specific to the current change set.
- PR title and body must be written in English.
- Never use a `hotfix` title or label for an ordinary bug fix. It opts the PR into automatic backporting after merge when one matching draft release is active.
- Never create the PR before showing the full final body to the user, unless they explicitly waive the preview or confirmation.
- Never rely on command permission prompts as PR body preview.
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
