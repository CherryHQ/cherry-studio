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
- If the user describes a work item, maintenance, documentation, CI/CD, or other actionable items -> Task
- If the user is asking a question or needs help with something -> Questions & Discussion
- Otherwise -> Others

**If unclear**, ask the user which template to use. Do not default to "Others" on your own.

### Step 2: Read the Selected Template

1. Read the corresponding template file:
   - For Bug Report, Feature Request, Questions & Discussion, and Others: read from `.github/ISSUE_TEMPLATE/` directory.
   - For Task: read from `.github/TASK_TEMPLATE.yml` (not in `ISSUE_TEMPLATE/` — this template is only used by this skill, not shown to external users).
2. Identify required fields (`validations.required: true`), title prefix (`title`), and labels (`labels`, if present).
3. Check if the template has a `type` field (e.g., `type: Bug`, `type: Feature`, `type: Task`). This will be used in Step 5 to set the issue type.

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

#### When the template has a `type` field

Use `gh cherry issue create` to create the issue with the type set automatically:

```bash
issue_body_file="$(mktemp /tmp/gh-issue-body-XXXXXX).md"
cat > "$issue_body_file" <<'EOF'
...issue body built from selected template...
EOF
```

```bash
gh cherry issue create -t "<title_with_template_prefix>" --body-file "$issue_body_file" -T "<type_from_template>"
```

If the selected template includes labels, append one `--label` per label:

```bash
gh cherry issue create -t "<title_with_template_prefix>" --body-file "$issue_body_file" -T "<type_from_template>" --label "<label_1>" --label "<label_2>"
```

> **Prerequisite**: The `gh-cherry` extension must be installed.
> Before using `gh cherry`, check if it's available by running `gh cherry --help`.
> If not installed, prompt the user to install it:
> ```bash
> gh extension install EurFelux/gh-cherry
> ```
> If the user declines installation, fall back to `gh issue create` (see below) and warn that the issue type was not set.

#### When the template has no `type` field

Use `gh issue create` command to create the issue:

```bash
gh issue create --title "<title_with_template_prefix>" --body-file "$issue_body_file"
```

If the selected template includes labels, append one `--label` per label:

```bash
gh issue create --title "<title_with_template_prefix>" --body-file "$issue_body_file" --label "<label_1_from_template>" --label "<label_2_from_template>"
```

#### Other options

You may use `--template` as a starting point (use the exact template name from the repository):

```bash
gh issue create --template "<template_name>"
```

Use the `--web` flag to open the creation page in browser when complex formatting is needed:

```bash
gh issue create --web
```

#### Cleanup

Clean up the temp file after creation:

```bash
rm -f "$issue_body_file"
```

## Notes

- Must read template files under `.github/ISSUE_TEMPLATE/` (or `.github/TASK_TEMPLATE.yml` for Task) to ensure following the correct format.
- Treat template files as the only source of truth. Do not hardcode title prefixes or labels in this skill.
- Title must be clear and concise, avoid vague terms like "a suggestion" or "stuck".
- Provide as much detail as possible to help developers understand and resolve the issue.
- If user doesn't specify a template type, ask them to choose one first.
