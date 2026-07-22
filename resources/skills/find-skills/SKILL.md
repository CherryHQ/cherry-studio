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

## The skill tools

Cherry gives you two built-in tools for skills — use them, and do NOT shell out to
`npx skills`, `git`, or any package manager:

- **`search_skills(query)`** — search the marketplace by keyword. Returns matches, each with an
  opaque `install_source` value.
- **`install_skill(install_source)`** — install ONE skill into Cherry's managed
  library and enable it for this agent. Cherry clones the repo, installs just that one skill,
  and registers it in a single deterministic step. Permission handling follows the active Claude
  permission mode (Step 6).

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Check the Leaderboard First

Before running a CLI search, check the [skills.sh leaderboard](https://skills.sh/) to see if a well-known skill already exists for the domain. The leaderboard ranks skills by total installs, surfacing the most popular and battle-tested options.

For example, top skills for web development include:
- `vercel-labs/agent-skills` — React, Next.js, web design (100K+ installs each)
- `anthropics/skills` — Frontend design, document processing (100K+ installs)

### Step 3: Search for Skills

If the leaderboard doesn't cover the user's need, call the `search_skills` tool:

- User asks "how do I make my React app faster?" → `search_skills("react performance")`
- User asks "can you help me with PR reviews?" → `search_skills("pr review")`
- User asks "I need to create a changelog" → `search_skills("changelog")`

Each result includes an opaque `install_source` — pass that exact value to
`install_skill`.

### Step 4: Verify Quality Before Recommending

**Do not recommend a skill based solely on search results.** Always verify:

1. **Install count** — Prefer skills with 1K+ installs. Be cautious with anything under 100.
2. **Source reputation** — Official sources (`vercel-labs`, `anthropics`, `microsoft`) are more trustworthy than unknown authors.
3. **GitHub stars** — Check the source repository. A skill from a repo with <100 stars should be treated with skepticism.

### Step 5: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. The install count and source
3. That you can install it for them into Cherry
4. A link to learn more at skills.sh

Example response:

```
I found a skill that might help! The "react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.
(185K installs)

I can install it into Cherry's skill library for you — want me to go ahead?

Learn more: https://skills.sh/vercel-labs/agent-skills/react-best-practices
```

### Step 6: Install (Uses the Active Permission Mode)

**⚠️ Security:** Skills are third-party code that runs with full agent
permissions. A malicious skill could read, modify, or delete files on your
system.

Before installing any skill:

1. **Show a security warning** — tell the user that the skill is third-party
   code and will run with full agent permissions.
2. **Provide a review link** — the skills.sh page (or source repository) so
   the user can review the skill's SKILL.md and any scripts it contains.
3. **Require install intent** — call `install_skill` only when the user asked to install the skill
   or accepted a presented option. A search-only request must not mutate the skill library.

Once the user has expressed install intent, call `install_skill` with the exact `install_source`
from the search result. Do not add another model-level confirmation step: Claude's active permission
mode is the authority. Default and accept-edits modes may prompt through the SDK; bypass-permissions
mode runs directly.

- `install_skill("claude-plugins:vercel-labs/agent-skills/skills/react-best-practices")`

Do **not** run `npx skills add`, `git clone`, or any shell command to install — that would
install the whole repo (dozens of skills), scatter symlinks across other tools, and land
outside Cherry's library. `install_skill` installs **only that one skill** into Cherry's
managed library in one deterministic step. The Claude Agent SDK applies the configured permission
mode before it runs. Once done it is registered and listed in the app — nothing is left elsewhere.

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
3. Offer to author a custom skill for the task (the skill-creator skill handles this)

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, I can author a custom skill for you — just ask
me to "create a skill for <task>" and I'll write one into Cherry's skills directory.
```
