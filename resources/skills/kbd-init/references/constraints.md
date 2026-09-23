# KBD Generic Constraint Configuration

This file defines **project-generic** constraint rules for KBD. Each project
should override or extend these in `.kbd-orchestrator/constraints.md` at the
repo root. This file documents the format and provides sensible defaults.

---

## How to Use

1. Copy this file to `.kbd-orchestrator/constraints.md` in your project root
2. Customize `blocking` and `warning` constraints for your stack
3. KBD and all executing tools will read this file during verification

When project instructions require a command wrapper or environment variable,
apply it to every affected `command:` and workflow trigger in this file. For
chained compiling commands, repeat the prefix for each command segment. Preserve
explicit repository-owned path exceptions instead of generalizing from a hidden
directory name.

---

## Blocking Constraints (prevent archiving until resolved)

These are universal to all projects:

```yaml
constraints:
  - id: no-console-log-in-commits
    severity: blocking
    description: 'No console.log statements in committed TypeScript/JavaScript'
    check: "grep -r 'console\\.log' src/ --include='*.ts' --include='*.tsx' --include='*.js'"

  - id: no-any-type
    severity: blocking
    description: 'No `any` type usage in TypeScript source'
    check: "grep -rn ': any' src/ --include='*.ts' --include='*.tsx'"

  - id: no-hardcoded-secrets
    severity: blocking
    description: 'No hardcoded API keys, tokens, or passwords in source'
    check: "grep -rn 'sk-\\|api_key\\|API_KEY\\|secret.*=.*[\"\\x27][A-Za-z0-9]' src/"

  - id: build-passes
    severity: blocking
    description: 'Project build must pass without errors'
    command: '<see .kbd-orchestrator/project.json build_health_command>'

  - id: no-unused-imports
    severity: blocking
    description: 'No unused imports (varies by language)'
    note: 'Enforce via lint command in project.json'
```

---

## Warning Constraints (acknowledge before archiving)

```yaml
- id: tests-for-new-features
  severity: warning
  description: 'Tests exist for all new features added in this change'

- id: no-lint-warnings
  severity: warning
  description: 'No lint warnings at default severity'
  command: '<see .kbd-orchestrator/project.json lint_command>'

- id: no-stub-comments
  severity: warning
  description: 'No TODO/FIXME/STUB/HACK comments in committed code'
  check: "grep -rn 'TODO\\|FIXME\\|STUB\\|HACK' src/"

- id: accessibility-basics
  severity: warning
  description: 'New UI components have aria-label or semantic HTML'
  note: 'Manual review required'
```

---

## Workflow Triggers

These run after each change iteration:

```yaml
workflow_triggers:
  - event: on_iteration_complete
    action:
      type: command
      target: '<build_health_command from project.json>'

  - event: on_change_complete
    action:
      type: command
      target: '<test_command from project.json>'

  - event: on_refinement_complete
    action:
      type: command
      target: "git add -A && git commit -m 'kbd: refine <change-id>'"
```

---

## Project-Specific Overrides

Add project-specific constraints below after copying to `.kbd-orchestrator/constraints.md`:

```yaml
# Project: <project-name>
# Added: <date>
constraints:
  # Add your project-specific blocking constraints here
  # Examples:
  # - id: tenant-id-on-all-queries
  #   severity: blocking
  #   description: "All Supabase queries must include .eq('tenant_id', tenantId)"
```
