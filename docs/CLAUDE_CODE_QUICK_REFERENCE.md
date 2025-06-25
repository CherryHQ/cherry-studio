# Claude Code GitHub Actions - Quick Reference

## 🚀 Quick Setup

```bash
# Automated setup (recommended)
claude /install-github-app

# Manual setup
1. Install app: https://github.com/apps/claude
2. Add secret: ANTHROPIC_API_KEY
3. Copy workflow to .github/workflows/
```

## 📝 Minimal Workflow

```yaml
name: Claude Assistant
on: [issue_comment, pull_request]

jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## ⚙️ Essential Configuration

```yaml
- uses: anthropics/claude-code-base-action@beta
  with:
    # Authentication (choose one)
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    # aws_region: us-east-1  # For Bedrock
    # gcp_project_id: my-project  # For Vertex
    
    # Core options
    prompt: "Your task here"
    max_turns: "5"              # Limit costs
    timeout_minutes: "30"       # Prevent hanging
    
    # Tools (be specific!)
    allowed_tools: "Read,Write,Bash(git:*)"
    
    # Custom environment
    claude_env: |
      NODE_ENV: test
      API_KEY: ${{ secrets.API_KEY }}
```

## 🛡️ Security Checklist

- [ ] API key in GitHub Secrets (never hardcode!)
- [ ] Minimal permissions in workflow
- [ ] Scoped tool access (e.g., `Bash(git:*)`)
- [ ] CLAUDE.md for project guidelines
- [ ] Restrict triggers to trusted users

## 💰 Cost Control

| Strategy | Implementation | Savings |
|----------|----------------|---------|
| Use Sonnet | `model: claude-3-sonnet` | 5x cheaper |
| Limit turns | `max_turns: "3"` | Prevents runaway |
| Cache prompts | Built-in 1hr cache | Reduces tokens |
| Concurrency | `concurrency: group` | Prevents duplicates |

## 🔧 Common Patterns

### Code Review
```yaml
on: pull_request
steps:
  - uses: anthropics/claude-code-action@beta
    with:
      prompt: "Review for bugs, security, and performance"
```

### Auto-fix Issues
```yaml
on:
  issues:
    types: [assigned]
if: github.event.assignee.login == 'claude[bot]'
```

### Documentation Updates
```yaml
on:
  push:
    paths: ['src/api/**']
steps:
  - uses: anthropics/claude-code-action@beta
    with:
      prompt: "Update API docs based on changes"
```

## 🛠️ Tool Reference

| Tool | Purpose | Example |
|------|---------|---------|
| `Read` | Read files | View code |
| `Write` | Modify files | Fix bugs |
| `Bash` | Shell commands | `Bash(git:*)` |
| `GlobTool` | Find files | Pattern matching |
| `GrepTool` | Search content | Find usages |

MCP tools: `mcp__<server>__<tool>`

## 📊 Monitoring

```yaml
# Cost tracking in outputs
outputs:
  cost: ${{ steps.claude.outputs.total_cost_usd }}
  tokens: ${{ steps.claude.outputs.total_tokens }}
```

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Auth fails | Check API key in secrets |
| High costs | Reduce `max_turns`, use Sonnet |
| Tool errors | Verify `allowed_tools` syntax |
| No response | Check trigger conditions |

## 📚 Resources

- Docs: https://docs.anthropic.com/claude-code/github-actions
- Examples: https://github.com/anthropics/claude-code-action
- SDK: `npm i @anthropic-ai/claude-code`

## 🎯 Pro Tips

1. **CLAUDE.md** - Define coding standards at repo root
2. **Slash commands** - Store prompts in `.claude/commands/`
3. **Batch operations** - Group related tasks in one prompt
4. **Debug mode** - Add `DEBUG: true` to `claude_env`
5. **Progress tracking** - Claude shows checkboxes for tasks

---

💡 **Remember**: Detailed prompts = 50% faster responses!