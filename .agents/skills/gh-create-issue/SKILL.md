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
- Otherwise -> Others

**If unclear**, ask the user which template to use. Do not default to "Others" on your own.

### Step 2: Read the Selected Template

1. Read the corresponding template file from `.github/ISSUE_TEMPLATE/` directory.
2. Identify required fields (`validations.required: true`), title prefix (`title`), and labels (`labels`, if present).

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

You may use `--template` as a starting point (use the exact template name from the repository):

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

- Must read template files under `.github/ISSUE_TEMPLATE/` to ensure following the correct format.
- Treat template files as the only source of truth. Do not hardcode title prefixes or labels in this skill.
- Title must be clear and concise, avoid vague terms like "a suggestion" or "stuck".
- Provide as much detail as possible to help developers understand and resolve the issue.
- If user doesn't specify a template type, ask them to choose one first.
