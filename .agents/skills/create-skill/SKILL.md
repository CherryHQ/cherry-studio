---
name: create-skill
description: Create a new skill in the current repository. Use when the user wants to create/add a new skill, or mentions creating a skill from scratch. This skill follows the workflow defined in .agents/skills/README.md and helps scaffold, validate, and sync new skills.
---

# Create Skill

Create a new skill in `.agents/skills/<skill-name>/` following the workflow defined in `.agents/skills/README.md`.

## Workflow

### Step 1: Gather Intent

Before creating anything, ask the user:

1. **Skill name**: What should the skill be called? (lowercase, digits, hyphens only, e.g., `gh-create-pr`, `prepare-release`)
2. **Description**: What should this skill do? Include specific trigger contexts (e.g., "Use when user asks to create PRs")
3. **Is this a public skill?**: Should it be synced to `.claude/skills/` for shared use? (default: no, private only)
4. **Test cases** (optional): Does the user want to set up evals for this skill?

If the user provides partial info (e.g., just a name), proceed with reasonable defaults and ask to confirm.

### Step 2: Read Guidelines

Always read `.agents/skills/README.md` before creating a new skill to ensure compliance with the current workflow.

### Step 3: Create Skill Structure

Create the following directory structure:

```
.agents/skills/<skill-name>/
└── SKILL.md
```

**SKILL.md template:**

```markdown
---
name: <skill-name>
description: <description>
---

# <Skill Name>

[Instructions for the skill]
```

**Frontmatter fields:**
- `name`: Skill identifier (lowercase, digits, hyphens)
- `description`: When to trigger (what the skill does + specific contexts)

### Step 4: Sync (if public)

If the user wants a **public skill**, before validation:

1. Add the skill name to `.agents/skills/public-skills.txt` (one per line, no inline comments)
2. Run sync:
   ```bash
   pnpm skills:sync
   ```

This copies the skill to `.claude/skills/<skill-name>/`.

**Note**: `pnpm skills:check` primarily validates public skills (those in `public-skills.txt`) and also verifies related governance files, so you must sync first before validating.

### Step 5: Validate

Run the validation command:

```bash
pnpm skills:check
```

If there are issues, fix them and re-run.

### Step 6: Summary

Present the user with:
- Created files
- Validation result
- Next steps (how to use the skill)

## Naming Rules

- Use lowercase letters, digits, and hyphens only
- Prefer short, action-oriented names (e.g., `gh-create-pr`)

## Public vs Private Skills

| Type | Location | Sync | Requires |
|------|----------|------|----------|
| Private | `.agents/skills/` | No | Just create the folder |
| Public | Both | Yes | Add to `public-skills.txt` + run `pnpm skills:sync` |

## Commands Reference

```bash
# Validate skill structure
pnpm skills:check

# Sync public skills to Claude
pnpm skills:sync
```

## Constraints

- Never create skills outside `.agents/skills/<skill-name>/`
- Always run `pnpm skills:check` before completing
- Public skills require both adding to `public-skills.txt` AND running `pnpm skills:sync`
- If the skill-creator skill is available, you may use it for advanced skill development (evals, iterations), but this skill handles the basic creation workflow.
