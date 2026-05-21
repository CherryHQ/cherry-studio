---
name: claude-automation-recommender
description: Analyze a codebase and recommend Claude Code automations (hooks, subagents, skills, plugins, MCP servers). Use when user asks for automation recommendations, wants to optimize their Claude Code setup, mentions improving Claude Code workflows, asks how to first set up Claude Code for a project, or wants to know what Claude Code features they should use.
tools: Read, Glob, Grep, Bash
---

# Claude Automation Recommender

Analyze codebase patterns to recommend tailored Claude Code automations across all extensibility options.

**This skill is read-only.** It analyzes the codebase and outputs recommendations. It does NOT create or modify any files. Users implement the recommendations themselves or ask Claude separately to help build them.

## Output Guidelines

- **Recommend 1-2 of each type**: Don't overwhelm - surface the top 1-2 most valuable automations per category
- **If user asks for a specific type**: Focus only on that type and provide more options (3-5 recommendations)
- **Go beyond the reference lists**: The reference files contain common patterns, but use web search to find recommendations specific to the codebase's tools, frameworks, and libraries
- **Tell users they can ask for more**: End by noting they can request more recommendations for any specific category

## Automation Types Overview

| Type | Best For |
|------|----------|
| **Hooks** | Automatic actions on tool events (format on save, lint, block edits) |
| **Subagents** | Specialized reviewers/analyzers that run in parallel |
| **Skills** | Packaged expertise, workflows, and repeatable tasks (invoked by Claude or user via `/skill-name`) |
| **Plugins** | Collections of skills that can be installed |
| **MCP Servers** | External tool integrations (databases, APIs, browsers, docs) |

## Workflow

### Phase 1: Codebase Analysis

Gather project context:

```bash
# Detect project type and tools
ls -la package.json pyproject.toml Cargo.toml go.mod pom.xml 2>/dev/null
cat package.json 2>/dev/null | head -50

# Check dependencies for MCP server recommendations
cat package.json 2>/dev/null | grep -E '"(react|vue|angular|next|express|fastapi|django|prisma|supabase|stripe)"'

# Check for existing Claude Code config
ls -la .claude/ CLAUDE.md 2>/dev/null

# Analyze project structure
ls -la src/ app/ lib/ tests/ components/ pages/ api/ 2>/dev/null
```

**Key Indicators to Capture:**

| Category | What to Look For | Informs Recommendations For |
|----------|------------------|----------------------------|
| Language/Framework | package.json, pyproject.toml, import patterns | Hooks, MCP servers |
| Frontend stack | React, Vue, Angular, Next.js | Playwright MCP, frontend skills |
| Backend stack | Express, FastAPI, Django | API documentation tools |
| Database | Prisma, Supabase, raw SQL | Database MCP servers |
| External APIs | Stripe, OpenAI, AWS SDKs | context7 MCP for docs |
| Testing | Jest, pytest, Playwright configs | Testing hooks, subagents |
| CI/CD | GitHub Actions, CircleCI | GitHub MCP server |
| Issue tracking | Linear, Jira references | Issue tracker MCP |
| Docs patterns | OpenAPI, JSDoc, docstrings | Documentation skills |

### Phase 2: Generate Recommendations

Based on analysis, generate recommendations across all categories:

#### A. MCP Server Recommendations

See [references/mcp-servers.md](references/mcp-servers.md) for detailed patterns.

| Codebase Signal | Recommended MCP Server |
|-----------------|------------------------|
| Uses popular libraries (React, Express, etc.) | **context7** - Live documentation lookup |
| Frontend with UI testing needs | **Playwright** - Browser automation/testing |
| Uses Supabase | **Supabase MCP** - Direct database operations |
| PostgreSQL/MySQL database | **Database MCP** - Query and schema tools |
| GitHub repository | **GitHub MCP** - Issues, PRs, actions |
| Uses Linear for issues | **Linear MCP** - Issue management |
| AWS infrastructure | **AWS MCP** - Cloud resource management |
| Slack workspace | **Slack MCP** - Team notifications |
| Memory/context persistence | **Memory MCP** - Cross-session memory |
| Sentry error tracking | **Sentry MCP** - Error investigation |
| Docker containers | **Docker MCP** - Container management |

#### B. Skills Recommendations

See [references/skills-reference.md](references/skills-reference.md) for details.

Create skills in `.claude/skills/<name>/SKILL.md`. Some are also available via plugins:

| Codebase Signal | Skill | Plugin |
|-----------------|-------|--------|
| Building plugins | skill-development | plugin-dev |
| Git commits | commit | commit-commands |
| React/Vue/Angular | frontend-design | frontend-design |
| Automation rules | writing-rules | hookify |
| Feature planning | feature-dev | feature-dev |

**Custom skills to create** (with templates, scripts, examples):

| Codebase Signal | Skill to Create | Invocation |
|-----------------|-----------------|------------|
| API routes | **api-doc** (with OpenAPI template) | Both |
| Database project | **create-migration** (with validation script) | User-only |
| Test suite | **gen-test** (with example tests) | User-only |
| Component library | **new-component** (with templates) | User-only |
| PR workflow | **pr-check** (with checklist) | User-only |
| Releases | **release-notes** (with git context) | User-only |
| Code style | **project-conventions** | Claude-only |
| Onboarding | **setup-dev** (with prereq script) | User-only |

#### C. Hooks Recommendations

See [references/hooks-patterns.md](references/hooks-patterns.md) for configurations.

| Codebase Signal | Recommended Hook |
|-----------------|------------------|
| Prettier configured | PostToolUse: auto-format on edit |
| ESLint/Ruff configured | PostToolUse: auto-lint on edit |
| TypeScript project | PostToolUse: type-check on edit |
| Tests directory exists | PostToolUse: run related tests |
| `.env` files present | PreToolUse: block `.env` edits |
| Lock files present | PreToolUse: block lock file edits |
| Security-sensitive code | PreToolUse: require confirmation |

#### D. Subagent Recommendations

See [references/subagent-templates.md](references/subagent-templates.md) for templates.

| Codebase Signal | Recommended Subagent |
|-----------------|---------------------|
| Large codebase (>500 files) | **code-reviewer** - Parallel code review |
| Auth/payments code | **security-reviewer** - Security audits |
| API project | **api-documenter** - OpenAPI generation |
| Performance critical | **performance-analyzer** - Bottleneck detection |
| Frontend heavy | **ui-reviewer** - Accessibility review |
| Needs more tests | **test-writer** - Test generation |

#### E. Plugin Recommendations

See [references/plugins-reference.md](references/plugins-reference.md) for available plugins.

| Codebase Signal | Recommended Plugin |
|-----------------|-------------------|
| General productivity | **anthropic-agent-skills** - Core skills bundle |
| Document workflows | Install docx, xlsx, pdf skills |
| Frontend development | **frontend-design** plugin |
| Building AI tools | **mcp-builder** for MCP development |

### Phase 3: Output Recommendations Report

Format recommendations clearly. **Only include 1-2 recommendations per category** - the most valuable ones for this specific codebase. Skip categories that aren't relevant.

```markdown
## Claude Code Automation Recommendations

I've analyzed your codebase and identified the top automations for each category. Here are my top 1-2 recommendations per type:

### Codebase Profile
- **Type**: [detected language/runtime]
- **Framework**: [detected framework]
- **Key Libraries**: [relevant libraries detected]

---

### 🔌 MCP Servers

#### context7
**Why**: [specific reason based on detected libraries]
**Install**: `claude mcp add context7`

---

### 🎯 Skills

#### [skill name]
**Why**: [specific reason]
**Create**: `.claude/skills/[name]/SKILL.md`
**Invocation**: User-only / Both / Claude-only
**Also available in**: [plugin-name] plugin (if applicable)
```yaml
---
name: [skill-name]
description: [what it does]
disable-model-invocation: true  # for user-only
---
```

---

### ⚡ Hooks

#### [hook name]
**Why**: [specific reason based on detected config]
**Where**: `.claude/settings.json`

---

### 🤖 Subagents

#### [agent name]
**Why**: [specific reason based on codebase patterns]
**Where**: `.claude/agents/[name].md`

---

**Want more?** Ask for additional recommendations for any specific category (e.g., "show me more MCP server options" or "what other hooks would help?").

**Want help implementing any of these?** Just ask and I can help you set up any of the recommendations above.
```

## Decision Framework

### When to Recommend MCP Servers
- External service integration needed (databases, APIs)
- Documentation lookup for libraries/SDKs
- Browser automation or testing
- Team tool integration (GitHub, Linear, Slack)
- Cloud infrastructure management

### When to Recommend Skills

- Document generation (docx, xlsx, pptx, pdf — also in plugins)
- Frequently repeated prompts or workflows
- Project-specific tasks with arguments
- Applying templates or scripts to tasks (skills can bundle supporting files)
- Quick actions invoked with `/skill-name`
- Workflows that should run in isolation (`context: fork`)

**Invocation control:**
- `disable-model-invocation: true` — User-only (for side effects: deploy, commit, send)
- `user-invocable: false` — Claude-only (for background knowledge)
- Default (omit both) — Both can invoke

### When to Recommend Hooks
- Repetitive post-edit actions (formatting, linting)
- Protection rules (block sensitive file edits)
- Validation checks (tests, type checks)

### When to Recommend Subagents
- Specialized expertise needed (security, performance)
- Parallel review workflows
- Background quality checks

### When to Recommend Plugins
- Need multiple related skills
- Want pre-packaged automation bundles
- Team-wide standardization

---

## Configuration Tips

### MCP Server Setup

**Team sharing**: Check `.mcp.json` into repo so entire team gets same MCP servers

**Debugging**: Use `--mcp-debug` flag to identify configuration issues

**Prerequisites to recommend:**
- GitHub CLI (`gh`) - enables native GitHub operations
- Puppeteer/Playwright CLI - for browser MCP servers

### Headless Mode (for CI/Automation)

Recommend headless Claude for automated pipelines:

```bash
# Pre-commit hook example
claude -p "fix lint errors in src/" --allowedTools Edit,Write

# CI pipeline with structured output
claude -p "<prompt>" --output-format stream-json | your_command
```

### Permissions for Hooks

Configure allowed tools in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Edit", "Write", "Bash(npm test:*)", "Bash(git commit:*)"]
  }
}
```
