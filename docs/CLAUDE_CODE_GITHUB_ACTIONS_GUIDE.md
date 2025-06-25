# Claude Code SDK GitHub Actions - Comprehensive Guide

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Installation & Setup](#installation--setup)
4. [Configuration Options](#configuration-options)
5. [Prompt Engineering Best Practices](#prompt-engineering-best-practices)
6. [Security Considerations](#security-considerations)
7. [Rate Limiting & Cost Optimization](#rate-limiting--cost-optimization)
8. [Integration Patterns](#integration-patterns)
9. [Advanced Workflows](#advanced-workflows)
10. [Troubleshooting](#troubleshooting)

## Overview

Claude Code SDK enables powerful AI-assisted development directly within GitHub Actions workflows. It provides:

- 🤖 **Interactive Code Assistant**: Claude can answer questions about code, architecture, and programming
- 🔍 **Code Review**: Analyzes PR changes and suggests improvements
- ✨ **Code Implementation**: Can implement fixes, refactoring, and new features
- 💬 **PR/Issue Integration**: Works seamlessly with GitHub comments and PR reviews
- 🛠️ **Flexible Tool Access**: Access to GitHub APIs and file operations
- 📋 **Progress Tracking**: Visual progress indicators with checkboxes

### Available SDKs
- **Command Line**: Direct terminal interaction
- **TypeScript SDK**: `@anthropic-ai/claude-code` on NPM
- **Python SDK**: `claude-code-sdk` on PyPI

### Supported Events
- `pull_request`: When PRs are opened or synchronized
- `issue_comment`: When comments are created on issues or PRs
- `pull_request_comment`: When comments are made on PR diffs
- `issues`: When issues are opened or assigned
- `pull_request_review`: When PR reviews are submitted

## Quick Start

The easiest setup method is through Claude Code in the terminal:

```bash
claude /install-github-app
```

This command will:
1. Guide you through GitHub app installation
2. Help set up required secrets
3. Create a workflow file in your repository

### Manual Setup

1. **Install GitHub App**: https://github.com/apps/claude
2. **Add API Key**: Add `ANTHROPIC_API_KEY` to repository secrets
3. **Create Workflow**: Add workflow file to `.github/workflows/`

## Installation & Setup

### Basic Workflow Configuration

```yaml
name: Claude Assistant
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude-response:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Authentication Methods

1. **Anthropic Direct API** (Recommended for simplicity)
   ```yaml
   anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

2. **Amazon Bedrock** (OIDC authentication required)
   ```yaml
   aws_region: us-east-1
   aws_role_arn: ${{ secrets.AWS_ROLE_ARN }}
   ```

3. **Google Vertex AI** (OIDC authentication required)
   ```yaml
   gcp_project_id: ${{ secrets.GCP_PROJECT_ID }}
   gcp_service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
   ```

## Configuration Options

### Core Parameters

```yaml
- uses: anthropics/claude-code-base-action@beta
  with:
    # Required
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    
    # Optional Parameters
    trigger_phrase: "@claude"              # Custom trigger (default: @claude)
    assignee_trigger: "claude"            # Trigger on issue assignment
    max_turns: "5"                        # Limit conversation turns
    timeout_minutes: "30"                 # Max execution time
    permission_mode: "acceptEdits"        # Permission handling
    
    # Tool Configuration
    allowed_tools: "Read,Write,Bash(git:*),GlobTool,GrepTool"
    
    # Custom Prompt
    prompt: "Review this code for security issues"
    system_prompt: "You are a security expert"
    append_system_prompt: "Always explain your reasoning"
    
    # Environment Variables (YAML format)
    claude_env: |
      NODE_ENV: test
      API_URL: ${{ vars.API_URL }}
      DEBUG: true
```

### Tool Permissions

Available built-in tools:
- `Read`: Read file contents
- `Write`: Write/modify files
- `Bash`: Execute shell commands (can be scoped: `Bash(git:*)`)
- `GlobTool`: File pattern matching
- `GrepTool`: Search file contents
- `BatchTool`: Batch operations

MCP tools format: `mcp__<server_name>__<tool_name>`

## Prompt Engineering Best Practices

### 1. CLAUDE.md Configuration

Create a `CLAUDE.md` file at your repository root:

```markdown
# Project Guidelines for Claude

## Code Standards
- Use TypeScript for all new code
- Follow ESLint configuration
- Maintain 90% test coverage
- Use async/await over promises

## Architecture Principles
- Keep components small and focused
- Use dependency injection
- Follow SOLID principles
- Document all public APIs

## Review Criteria
- Check for security vulnerabilities
- Verify performance implications
- Ensure backward compatibility
- Validate error handling
```

### 2. Structured Prompts

Store reusable prompts in `.claude/commands/`:

```markdown
# .claude/commands/security-review.md
Review the code changes for:
1. SQL injection vulnerabilities
2. XSS attack vectors
3. Authentication bypass risks
4. Sensitive data exposure
5. CSRF vulnerabilities

Provide specific line numbers and remediation suggestions.
```

### 3. Context-Aware Prompts

```yaml
- name: Context-aware code review
  uses: anthropics/claude-code-base-action@beta
  with:
    prompt: |
      Review the PR changes considering:
      - Our microservices architecture
      - The impact on dependent services
      - Database migration requirements
      - API backward compatibility
      
      Focus on: ${{ github.event.pull_request.title }}
```

### 4. Prompt Optimization Tips

- **Be Specific**: Detailed prompts reduce response time by ~50%
- **Provide Context**: Include relevant project information
- **Set Clear Boundaries**: Define what Claude should and shouldn't do
- **Use Examples**: Show desired output format when applicable

## Security Considerations

### 1. API Key Management

**CRITICAL: Never hardcode API keys!**

```yaml
# ✅ CORRECT - Using GitHub Secrets
anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

# ❌ NEVER DO THIS
anthropic_api_key: "sk-ant-api03-..."  # Exposed!
```

### 2. Permission Scoping

```yaml
permissions:
  contents: write      # Required for code modifications
  issues: write        # Required for issue comments
  pull-requests: write # Required for PR operations
  # Avoid using write-all permissions
```

### 3. Tool Access Control

```yaml
# Restrict bash commands to git operations only
allowed_tools: "Read,Write,Bash(git:*)"

# Never allow unrestricted bash access in public repos
# allowed_tools: "Bash"  # ❌ Dangerous
```

### 4. Environment Variable Security

```yaml
claude_env: |
  # Use GitHub Secrets for sensitive data
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  # Use GitHub Variables for non-sensitive config
  API_VERSION: ${{ vars.API_VERSION }}
```

### 5. OIDC Authentication (AWS/GCP)

More secure than static keys:
```yaml
# AWS Bedrock with OIDC
- uses: aws-actions/configure-aws-credentials@v1
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: us-east-1
```

## Rate Limiting & Cost Optimization

### Pricing Structure
- **Claude Opus 4**: $15/$75 per million tokens (input/output)
- **Claude Sonnet 4**: $3/$15 per million tokens (input/output)

### Cost Optimization Strategies

#### 1. Model Selection
```yaml
# Use Sonnet for routine tasks (5x cheaper)
model: claude-3-sonnet  # Default, good for most tasks

# Use Opus only for complex tasks
model: claude-3-opus    # Premium model
```

#### 2. Conversation Limits
```yaml
# Limit conversation turns to prevent runaway costs
max_turns: "3"  # Minimum needed for task
```

#### 3. Prompt Caching
Utilize one-hour prompt caching for repeated queries:
```yaml
# Cache system prompts and CLAUDE.md content
cache_control: true
```

#### 4. Efficient Runner Usage
Use optimized runners for cost savings:
```yaml
runs-on: depot-ubuntu-latest  # 50% cheaper, faster CPU/IO
```

#### 5. Cost Tracking
Monitor usage in action outputs:
```json
{
  "total_cost_usd": 0.003,
  "input_tokens": 1500,
  "output_tokens": 500
}
```

### Rate Limiting Strategies

1. **Workflow Concurrency**
   ```yaml
   concurrency:
     group: claude-${{ github.ref }}
     cancel-in-progress: true
   ```

2. **Time-based Restrictions**
   ```yaml
   if: github.event.issue.created_at > '2024-01-01'
   ```

3. **User Restrictions**
   ```yaml
   if: contains(fromJson('["user1", "user2"]'), github.actor)
   ```

## Integration Patterns

### 1. Automated Code Review

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: |
            Review the changes in this PR:
            1. Code quality and best practices
            2. Potential bugs or edge cases
            3. Performance implications
            4. Security concerns
            5. Test coverage
            
            Provide actionable feedback with line-specific comments.
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 2. Issue-to-PR Automation

```yaml
name: Auto-implement Issues
on:
  issues:
    types: [assigned]

jobs:
  auto-implement:
    if: github.event.assignee.login == 'claude[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: |
            Implement the feature described in issue #${{ github.event.issue.number }}:
            ${{ github.event.issue.body }}
            
            Create tests and documentation as needed.
          allowed_tools: "Read,Write,Bash(git:*),mcp__github__create_pull_request"
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 3. Documentation Generation

```yaml
name: Auto-generate Docs
on:
  push:
    paths:
      - 'src/api/**'
      - 'openapi.yaml'

jobs:
  update-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: |
            Update the API documentation based on the changes:
            1. Update README with new endpoints
            2. Generate example requests/responses
            3. Update the changelog
            4. Create migration guide if breaking changes
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 4. Test Generation

```yaml
name: Generate Missing Tests
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  generate-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check coverage
        run: npm run test:coverage
        
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: |
            Analyze the coverage report and:
            1. Identify untested functions
            2. Generate comprehensive test cases
            3. Include edge cases and error scenarios
            4. Maintain existing test patterns
          claude_env: |
            COVERAGE_FILE: coverage/lcov.info
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Advanced Workflows

### 1. Multi-Agent Collaboration

```yaml
name: Multi-Agent Development
on:
  workflow_dispatch:
    inputs:
      feature:
        description: 'Feature to implement'
        required: true

jobs:
  architect:
    runs-on: ubuntu-latest
    outputs:
      design: ${{ steps.design.outputs.result }}
    steps:
      - id: design
        uses: anthropics/claude-code-base-action@beta
        with:
          prompt: "Design the architecture for: ${{ github.event.inputs.feature }}"
          
  implement:
    needs: architect
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: |
            Implement the feature based on this design:
            ${{ needs.architect.outputs.design }}
            
  test:
    needs: implement
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-base-action@beta
        with:
          prompt: "Write comprehensive tests for the implemented feature"
```

### 2. MCP Server Integration

```yaml
- uses: anthropics/claude-code-base-action@beta
  with:
    mcp_config: |
      {
        "servers": {
          "database": {
            "command": "npx",
            "args": ["@modelcontextprotocol/server-sqlite", "db.sqlite"]
          },
          "api": {
            "command": "python",
            "args": ["mcp_server.py"]
          }
        }
      }
    allowed_tools: "mcp__database__query,mcp__api__fetch"
```

### 3. Conditional Workflows

```yaml
- name: Conditional Claude execution
  uses: anthropics/claude-code-base-action@beta
  if: |
    contains(github.event.comment.body, '@claude') &&
    (github.event.comment.author_association == 'OWNER' ||
     github.event.comment.author_association == 'MEMBER')
  with:
    prompt: "${{ github.event.comment.body }}"
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify API key is correctly set in secrets
   - Check key permissions and quotas
   - Ensure OIDC is configured for AWS/GCP

2. **Tool Access Errors**
   - Verify tool names in `allowed_tools`
   - Check MCP server configuration
   - Ensure file paths are accessible

3. **Rate Limiting**
   - Implement exponential backoff
   - Use workflow concurrency limits
   - Monitor API usage dashboard

4. **Cost Overruns**
   - Set `max_turns` limits
   - Use Sonnet model for routine tasks
   - Implement budget alerts

### Debug Mode

```yaml
- uses: anthropics/claude-code-base-action@beta
  with:
    claude_env: |
      DEBUG: true
      LOG_LEVEL: verbose
    prompt: "Debug this issue..."
```

### Getting Help

- **Documentation**: https://docs.anthropic.com/claude-code/github-actions
- **GitHub Issues**: https://github.com/anthropics/claude-code-action/issues
- **Community Forum**: https://community.anthropic.com

## Best Practices Summary

1. **Always use GitHub Secrets** for API keys
2. **Define clear guidelines** in CLAUDE.md
3. **Limit conversation turns** to control costs
4. **Use specific prompts** for better results
5. **Implement proper error handling** in workflows
6. **Monitor costs** through action outputs
7. **Use appropriate models** for different tasks
8. **Scope tool permissions** appropriately
9. **Cache prompts** for repeated operations
10. **Test workflows** in isolated environments first

---

*This guide is based on official Anthropic documentation and community best practices. Always refer to the latest official documentation for the most up-to-date information.*