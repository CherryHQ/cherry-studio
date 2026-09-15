# Engineering Task Template

Reference template for engineering work that is neither a user-facing bug nor a product feature:
follow-ups deferred from a merged pull request, technical debt, refactoring, tooling and CI work.

This template is deliberately **not** a GitHub issue form. GitHub only scans
`.github/ISSUE_TEMPLATE/` and lists everything there to every visitor, so keeping this file
outside that directory is what stops regular users from picking it. It is used by this skill only.

## Eligibility

Meant for maintainers and collaborators holding `write` or `admin` permission. This is a request
rather than an access control — please do not use this template without write access. The skill
checks the permission level before use so that it comes up early; see [SKILL.md](../SKILL.md)
Step 1.

## Metadata

| Field | Value |
| --- | --- |
| Title prefix | `[Task]: ` |
| Labels | `internal-team`, `Dev Team` |
| Issue type | `Task` |

## Creating the Issue

`--template` and `--web` do not work here — both resolve against `.github/ISSUE_TEMPLATE/` on the
default branch. Build the body locally and pass the metadata explicitly:

```bash
gh issue create --title "[Task]: <summary>" --body-file "$issue_body_file" \
  --label "internal-team" --label "Dev Team" --type "Task"
```

## Body

Keep the section order. Drop the two optional sections when they would be empty.

```markdown
### Task Type

<one of: Follow-up (deferred from a pull request) | Technical Debt | Refactor | Tooling & CI | Documentation | Other>

### Context

<Current state, and why this work needs to happen. Include the constraint or decision that led here.
e.g. PR #12345 introduced a temporary alias to keep the diff reviewable. It should be removed once the callers migrate.>

### Definition of Done

<How we know this task is complete. A checklist is preferred over prose.>

- [ ] ...
- [ ] ...

### References

<Optional. Related pull requests, issues, documents, or code locations.>

- PR: #12345
- Code: `src/main/services/example.ts`

### Additional Notes

<Optional. Known risks, blockers, or anything else worth recording.>

---

This task is not reserved for the core team. Community contributions are welcome — if you would like
to pick it up, leave a comment before you start so we can avoid duplicated work.
```
