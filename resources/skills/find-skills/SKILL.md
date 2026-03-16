---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query]` - Search for skills interactively or by keyword
- `npx skills add <package>` - Install a skill from GitHub or other sources
- `npx skills check` - Check for skill updates
- `npx skills update` - Update all installed skills

**Browse skills at:** https://skills.sh/

## Runtime Detection

Before running any `npx skills` command, check if `npx` is available:

```bash
which npx
```

If `npx` is **not found**, fall back to the bundled bun shipped with Cherry Studio.
The bun binary is installed by Cherry Studio at `$HOME/.cherrystudio/bin/bun`.
Verify it exists before using it:

```bash
CHERRY_BUN="$HOME/.cherrystudio/bin/bun"
if [ -x "$CHERRY_BUN" ]; then
  "$CHERRY_BUN" x skills <subcommand> [args]
else
  echo "Error: Neither npx nor bundled bun found. Install Node.js or run Cherry Studio's bun installer."
fi
```

For example, `npx skills find react` becomes `"$CHERRY_BUN" x skills find react`.

Always try `npx` first. Only use the bun fallback when npx is unavailable.

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Search for Skills

Run the find command with a relevant query:

```bash
npx skills find [query]
```

For example:

- User asks "how do I make my React app faster?" → `npx skills find react performance`
- User asks "can you help me with PR reviews?" → `npx skills find pr review`
- User asks "I need to create a changelog" → `npx skills find changelog`

The command will return results like:

```
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 3: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. The source repository link so the user can review the code
3. The install command they can run

Example response:

```
I found a skill that might help! The "vercel-react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.

Source: https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices

To install it (after you've reviewed the source):
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
```

### Step 4: Install (Requires User Confirmation)

**⚠️ Security:** Skills are third-party code that runs with full agent
permissions. A malicious skill could read, modify, or delete files in your
project.

Before installing any skill you **MUST**:

1. **Show a security warning** — tell the user that the skill is third-party
   code and will have access to their project files.
2. **Provide the source link** so the user can review the skill's SKILL.md and
   any scripts it contains.
3. **Ask the user for explicit confirmation** — do NOT run `npx skills add`
   until the user says "yes" or equivalent. Never install silently.

Only after the user confirms, run:

```bash
npx skills add <owner/repo@skill> -y
```

The `-y` flag is required for non-interactive execution, but the user
confirmation step above ensures the user has reviewed and approved the install.

Skills are installed to the current project's `.claude/skills/` directory.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user could create their own skill with `npx skills init`

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, you could create your own skill:
npx skills init my-xyz-skill
```
