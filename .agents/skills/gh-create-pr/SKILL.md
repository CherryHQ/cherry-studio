---
name: gh-create-pr
description: Create or update GitHub pull requests using the repository-required workflow and template compliance. Use when asked to create/open/update a PR so the assistant reads `.github/pull_request_template.md`, fills every template section, preserves markdown structure exactly, and marks missing data as N/A or None instead of skipping sections.
---

# GitHub PR Creation

## Workflow

1. Read `.github/pull_request_template.md` before drafting the PR body.
2. Collect PR context from the current branch (base/head, scope, linked issues, testing status, breaking changes, release note content).
3. Create a temp file and write the PR body:
   - Use `pr_body_file="$(mktemp /tmp/gh-pr-body-XXXXXX).md"`
   - Fill content using the template structure exactly (keep section order, headings, checkbox formatting).
   - If not applicable, write `N/A` or `None`.
4. Preview the temp file content. **Show the file path** (e.g., `/tmp/gh-pr-body-XXXXXX.md`) and ask for explicit confirmation before creating. **Skip this step if the user explicitly indicates no preview/confirmation is needed** (for example, automation workflows).
5. After confirmation, create the PR:
   ```bash
   gh pr create --base <base> --head <head> --title "<title>" --body-file "$pr_body_file"
   ```
6. Clean up the temp file: `rm -f "$pr_body_file"`
7. Report the created PR URL and summarize title/base/head and any required follow-up.

## Constraints

- Never skip template sections.
- Never rewrite the template format.
- Keep content concise and specific to the current change set.
- PR title and body must be written in English.
- Never create the PR before showing the full final body to the user, unless they explicitly waive the preview or confirmation.
- Never rely on command permission prompts as PR body preview.

## Command Pattern

```bash
# read template
cat .github/pull_request_template.md

# show this full Markdown body in chat first
pr_body_file="$(mktemp /tmp/gh-pr-body-XXXXXX).md"
cat > "$pr_body_file" <<'EOF'
...filled template body...
EOF

# run only after explicit user confirmation
gh pr create --base <base> --head <head> --title "<title>" --body-file "$pr_body_file"
rm -f "$pr_body_file"
```
