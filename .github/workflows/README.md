# AI-Powered GitHub Workflows

This directory contains AI-powered GitHub workflows that leverage Claude to automate various development tasks for the Neucleos project.

## Available Workflows

### 1. Claude Code Main (`claude-code-main.yml`)
**Purpose**: Main AI integration workflow for executing complex development tasks

**Triggers**:
- Manual trigger via workflow dispatch
- Input parameters: task description, context, branch, cost limit

**Features**:
- Perfect Information verification before execution
- Cost estimation and monitoring
- Automatic branch creation and PR generation
- Test and lint validation
- Security review checklist

**Usage Example**:
```yaml
# Trigger from GitHub Actions UI
Task: "Add dark mode support to the settings page"
Context: "Use the existing theme system and Material-UI components"
Branch: main
Cost Limit: 10
```

### 2. AI PR Review (`ai-pr-review.yml`)
**Purpose**: Automated code review for pull requests

**Triggers**:
- Automatically on PR open/update
- Manual trigger for specific PR
- Skip with `skip-ai-review` label

**Features**:
- Comprehensive code analysis
- Security vulnerability detection
- Line-specific comments
- Confidence scoring
- Auto-labeling based on review outcome

**Configuration**:
- Skip draft PRs unless labeled with `ai-review-draft`
- Skip AI-generated PRs
- Maximum file limit: 50 files
- Maximum additions: 2000 lines

### 3. AI Issue to PR (`ai-issue-to-pr.yml`)
**Purpose**: Convert GitHub issues to pull requests automatically

**Triggers**:
- Issue labeled with `ai-implement`
- Manual trigger with issue number

**Features**:
- Issue validation and complexity assessment
- Automatic implementation based on requirements
- Test execution and validation
- Draft PR for complex implementations
- Links PR back to original issue

**Issue Template for Best Results**:
```markdown
## Description
Clear description of what needs to be implemented

## Acceptance Criteria
- [ ] Specific requirement 1
- [ ] Specific requirement 2

## Technical Requirements
- Use TypeScript
- Follow existing patterns
- Add unit tests

## Implementation Notes
Any specific implementation guidance
```

### 4. AI Test Generation (`ai-test-generation.yml`)
**Purpose**: Generate tests for code with low coverage

**Triggers**:
- Weekly schedule (Sundays at 2 AM UTC)
- Manual trigger with coverage target

**Features**:
- Coverage analysis and gap identification
- Prioritized test generation for uncovered code
- Support for unit, integration, and e2e tests
- Automatic PR creation with coverage metrics
- Test validation and formatting

**Parameters**:
- `target_coverage`: Desired coverage percentage (default: 80%)
- `focus_path`: Specific directory to focus on
- `test_type`: Type of tests to generate (unit/integration/e2e)

### 5. AI Documentation Sync (`ai-docs-sync.yml`)
**Purpose**: Keep documentation synchronized with code changes

**Triggers**:
- Push to main branch (when code files change)
- Weekly schedule (Saturdays at 3 AM UTC)
- Manual trigger for full scan

**Features**:
- JSDoc/TSDoc generation for undocumented code
- README.md updates and section completion
- Architecture documentation generation
- CHANGELOG maintenance
- TypeDoc integration

**Documentation Types**:
- `api`: API documentation and JSDoc comments
- `readme`: README.md updates
- `architecture`: Architecture diagrams and docs
- `changelog`: CHANGELOG.md updates

## Security Measures

### API Key Management
- Store `ANTHROPIC_API_KEY` in GitHub Secrets
- Never commit API keys or expose them in logs
- Use environment variables for all sensitive data

### Code Review Requirements
- All AI-generated PRs are marked as such
- Human review required before merging
- Security checklist included in PR descriptions
- Draft PRs for complex changes

### Cost Controls
- Configurable cost limits per workflow
- Cost estimation before execution
- Usage tracking and reporting
- Automatic stops when limits exceeded

## Best Practices

### 1. Perfect Information
Always provide complete context:
- Specific requirements, not vague descriptions
- Technical constraints and preferences
- Examples of desired outcomes
- Existing patterns to follow

### 2. Incremental Changes
- Start with small, focused tasks
- Build complexity gradually
- Review and refine between iterations
- Combine multiple PRs for large features

### 3. Issue Templates
Use structured issue templates:
```markdown
## User Story
As a [user type], I want [feature] so that [benefit]

## Acceptance Criteria
- [ ] Given [context], when [action], then [result]
- [ ] ...

## Technical Requirements
- Framework/library constraints
- Performance requirements
- Security considerations

## Implementation Notes
- Suggested approach
- Files to modify
- Patterns to follow
```

### 4. Monitoring and Feedback
- Review AI-generated code carefully
- Provide feedback via PR comments
- Update prompts based on outcomes
- Track success metrics

## Customization

### Adjusting AI Behavior
Edit workflow files to modify:
- `CLAUDE_MODEL`: Change the AI model version
- `MAX_TOKENS`: Adjust response length limits
- `TEMPERATURE`: Control creativity (0.0-1.0)
- Cost limits and thresholds

### Adding New Workflows
1. Create new `.yml` file in `.github/workflows/`
2. Use existing workflows as templates
3. Include cost controls and security measures
4. Add documentation to this README

### Workflow Permissions
Ensure workflows have appropriate permissions:
```yaml
permissions:
  contents: write      # For code changes
  pull-requests: write # For PR creation
  issues: write        # For issue updates
  checks: write        # For status checks
```

## Troubleshooting

### Common Issues

1. **"No changes to commit"**
   - AI couldn't generate valid changes
   - Task might be too vague or complex
   - Check workflow logs for details

2. **"Estimated cost exceeds limit"**
   - Increase cost limit if needed
   - Break task into smaller pieces
   - Simplify requirements

3. **"Context incomplete"**
   - Add more specific details
   - Provide examples
   - Reference existing code

4. **Test Failures**
   - AI-generated code may have issues
   - Review and fix in the PR
   - Provide feedback for improvement

### Debugging
- Check workflow run logs in Actions tab
- Review `claude_response.json` artifacts
- Enable debug logging with `ACTIONS_STEP_DEBUG=true`
- Test workflows on feature branches first

## Cost Optimization

### Strategies
1. **Batch Operations**: Combine related tasks
2. **Caching**: Reuse previous analyses where possible
3. **Focused Scope**: Target specific files/areas
4. **Progressive Enhancement**: Start simple, iterate

### Monitoring
- Track costs in workflow summaries
- Set up billing alerts in Anthropic dashboard
- Review usage patterns monthly
- Optimize prompts for efficiency

## Future Enhancements

### Planned Features
- [ ] Multi-model support (GPT-4, Claude, etc.)
- [ ] Workflow composition and chaining
- [ ] Learning from previous interactions
- [ ] Custom review rules and patterns
- [ ] Integration with project management tools

### Contributing
To improve these workflows:
1. Test changes on feature branches
2. Document new features thoroughly
3. Include error handling
4. Update this README
5. Share learnings with the team

---

*These AI-powered workflows are designed to augment, not replace, human developers. Always review AI-generated code and documentation for accuracy, security, and alignment with project standards.*