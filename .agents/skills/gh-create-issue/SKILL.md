---
name: gh-create-issue
description: Use when user wants to create a GitHub issue for the current repository. Must read and follow the repository's issue template format.
---

# GitHub Create Issue

Use this skill when the user requests to create an issue. Must follow the repository's issue template format.

## Workflow

### Step 1: Determine Template Type

Analyze the user's request to determine the issue type:
- If the user describes a problem, error, crash, or something not working -> Bug Report
- If the user requests a new feature, enhancement, or additional support -> Feature Request
- If the user is asking a question or needs help with something -> Questions & Discussion
- If the user describes engineering work with no user-facing behavior change (a follow-up deferred from a pull request, technical debt, refactoring, tooling or CI work) -> Engineering Task
- Otherwise -> Others

Engineering Task is not a GitHub issue form and is not offered to regular users. Only select it when the request clearly describes internal engineering work.

**If unclear**, ask the user which template to use. Do not default to "Others" on your own.

#### Eligibility Check (Engineering Task only)

Engineering Task is restricted to repository members and collaborators with write access. Before
collecting any information, confirm the authenticated user's permission level:

```bash
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
user="$(gh api user --jq .login)"
permission="$(gh api "repos/$repo/collaborators/$user/permission" --jq .permission 2>/dev/null)"
case "$permission" in
  admin | write) echo "eligible" ;;
  *) echo "not eligible" ;;
esac
```

Only `admin` and `write` are eligible (`maintain` reports as `write`). Always compare the returned
value: on a public repository this endpoint answers `read` for any user, including one who is not a
collaborator at all, so a successful call proves nothing on its own. Do not use
`repos/{owner}/{repo}/collaborators/{user}` here — collaborators can hold `read` or `triage` only,
and those users cannot apply the restricted labels or the issue type anyway.

If the check fails, **stop**. Tell the user this template is restricted to members and
collaborators, and ask them to choose one of the public templates instead. Do not silently fall back
to another template, and do not create the issue with Engineering Task metadata.

### Step 2: Read the Selected Template

1. Read the corresponding template file from `.github/ISSUE_TEMPLATE/` directory.
2. Identify required fields (`validations.required: true`), title prefix (`title`), labels (`labels`, if present), and issue type (`type`, if present).

For Engineering Task, read [references/engineering-task.md](references/engineering-task.md) instead — it lives outside `.github/ISSUE_TEMPLATE/` on purpose and carries its own title prefix, labels, issue type, and body structure.

### Step 3: Collect Information

Based on the selected template, ask the user for required information only. Follow the template's required fields and option constraints (for example, Platform and Priority choices).

### Step 4: Build and Preview Issue Content

Create a temp file and write the issue content:
- Use `issue_body_file="$(mktemp /tmp/gh-issue-body-XXXXXX).md"`
- Use the exact title prefix from the selected template.
- Fill content following the template body structure and section order.
- Apply labels exactly as defined by the template.
- Keep all labels when there are multiple labels.
- If template has no labels, do not add custom labels.
- Apply the issue type exactly as defined by the template's `type` field.

Preview the temp file content. **Show the file path** (e.g., `/tmp/gh-issue-body-XXXXXX.md`) and ask for confirmation before creating. **Skip this step if the user explicitly indicates no preview/confirmation is needed** (for example, automation workflows).

### Step 5: Create Issue

Use `gh issue create` command to create the issue.

Use a unique temp file for the body:

```bash
issue_body_file="$(mktemp /tmp/gh-issue-body-XXXXXX).md"
cat > "$issue_body_file" <<'EOF'
...issue body built from selected template...
EOF
```

Create the issue using values from the selected template:

```bash
gh issue create --title "<title_with_template_prefix>" --body-file "$issue_body_file"
```

If the selected template includes labels, append one `--label` per label:

```bash
gh issue create --title "<title_with_template_prefix>" --body-file "$issue_body_file" --label "<label_1_from_template>" --label "<label_2_from_template>"
```

If the selected template has no labels, do not pass `--label`.

If the selected template declares a `type`, pass it as well. `--body-file` does not carry the issue type over on its own, so omitting this leaves the issue untyped:

```bash
gh issue create --title "<title_with_template_prefix>" --body-file "$issue_body_file" --type "<type_from_template>"
```

`--template` and `--web` resolve against `.github/ISSUE_TEMPLATE/` on the default branch, so neither works for Engineering Task. Build the body locally for it.

For the other templates you may use `--template` as a starting point (use the exact template name from the repository):

```bash
gh issue create --template "<template_name>"
```

Use the `--web` flag to open the creation page in browser when complex formatting is needed:

```bash
gh issue create --web
```

Clean up the temp file after creation:

```bash
rm -f "$issue_body_file"
```

## Notes

- Must read template files under `.github/ISSUE_TEMPLATE/` (or `references/` for Engineering Task) to ensure following the correct format.
- Treat template files as the only source of truth. Do not hardcode title prefixes, labels, or issue types in this skill.
- Title must be clear and concise, avoid vague terms like "a suggestion" or "stuck".
- Provide as much detail as possible to help developers understand and resolve the issue.
- If user doesn't specify a template type, ask them to choose one first.
