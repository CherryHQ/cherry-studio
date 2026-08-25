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
   - Inspect the head branch before applying any default. If the head is `release/v<version>`, stop: never open a pull request from a release branch, especially not to `main`. Put an isolated fix on a topic branch and target the release branch, or let Post Release create the metadata sync branch.
   - Before defaulting an arbitrary topic branch to `main`, inspect its merge base and upstream. A product-code fix that started from `release/v<version>` must stop and be recreated from `main` as a hotfix; only a release-only repair or explicit backport recovery topic may target that exact release branch.
   - A `backport/v<version>/pr-<number>` head must target the matching `release/v<version>` base and its body must contain `<!-- release-backport-source-pr: <number> -->` on its own line for the exact source hotfix PR. A `release-sync/v<version>` head must target `main`, use the exact title `chore(release): sync v<version> metadata`, retain the `release-metadata-boundary: v<version>` body marker, and be squash-merged.
   - For official repo(CherryHQ/cherry-studio) as `origin`: default base is `main` from `origin`, but allow the user to explicitly indicate a base branch.
   - `main` is the active development line, including hotfix PRs. Do not target an old maintenance branch unless the user explicitly requests it.
   - Only classify a PR as a release hotfix when the user explicitly says it must be included in the active draft release. Use the title `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>` with a lowercase alphanumeric kebab-case scope, exactly one space after the colon, and a non-empty description. The title grammar synchronizes the `hotfix` label automatically. Merging opens a separate backport PR only when exactly one draft semantic-version release has a matching active `release/v<version>` branch; otherwise automation stops without guessing a target.
   - If the hotfix is user-facing, provide one release-note line in each language so automation can update the active draft and stable release history. Put this exact structure inside the template's existing `release-note` fence; do not include bullet prefixes:
     ```text
     <!--LANG:en-->
     [Component] English description.
     <!--LANG:zh-CN-->
     [组件] 中文说明。
     <!--LANG:END-->
     ```
   - If the hotfix has no user-facing release note, keep `NONE` in the template's `release-note` fence. The code is still backported, but release metadata is unchanged. A provided bilingual block must satisfy the exact structure above.
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
   For a release hotfix, use an exact classifier-compatible title so the workflow synchronizes the label and separately validates any provided bilingual note:
   ```bash
   gh pr create --base main --head <head> --title "hotfix: <description>" --body-file "$pr_body_file"
   ```
   After creation, verify that the classifier added `hotfix`; if it did not, fix the title instead of adding the label manually. Also fix any malformed optional release-note block reported by the workflow.
8. Clean up the temp file: `rm -f "$pr_body_file"`
9. Report the created PR URL and summarize title/base/head and any required follow-up.

## Constraints

- Never skip template sections.
- Never rewrite the template format.
- Keep content concise and specific to the current change set.
- PR title and body must be written in English.
- Never use a `hotfix` title or label for an ordinary bug fix. It opts the PR into an automatic backport PR after merge when one matching draft release is active.
- A release hotfix may use `NONE` when it has no user-facing release note. Never provide a partial, single-language, or otherwise malformed bilingual note; the backport workflow fails closed on malformed content.
- Never default a `release/v<version>` head to `main`; a release branch is not a pull request source branch.
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
